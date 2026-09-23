const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure Uploads Directory Exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Ensure Sample Data Directory Exists
const sampleDir = path.join(__dirname, 'sample-data');
if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
}

// Multer Setup for Handling File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
        cb(null, true);
    } else {
        cb(new Error('INVALID_FILE_TYPE'), false);
    }
};

const upload = multer({ storage, fileFilter });

// Helper: Generate Document ID (PL-YYYYMMDD-XXXX)
let docCounter = 1;
function generateDocumentId() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const sequence = String(docCounter++).padStart(4, '0');
    return `PL-${dateStr}-${sequence}`;
}

// Parsing Logic Function
function parsePackingListText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];
    
    // Pattern Matching for Rows (Handles Tabular Data Extraction)
    // Matches patterns like: [PO] [SAP NO] [DESCRIPTION] [QTY] [CTNS] [N.W.] [G.W.] [MEAS]
    lines.forEach((line, index) => {
        // Broad regex to catch rows with PO, Item Code, Description and Quantities
        const rowRegex = /^(\d{8,10})\s+([A-Za-z0-9\-\.]+)\s+(.+?)\s+(\d+[\d,]*)\s*(PCS|SET|CTN|BOX)?\s+(\d+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.\*xX]+)?/i;
        const match = line.match(rowRegex);

        if (match) {
            items.push({
                id: items.length + 1,
                sapPo: match[1] || '',
                sapNo: match[2] || '',
                description: match[3] || '',
                totalQty: match[4] ? match[4].replace(/,/g, '') : '',
                qtyPcs: match[4] ? match[4].replace(/,/g, '') : '',
                qtyCtns: match[6] || '',
                nw: match[7] || '',
                gw: match[8] || '',
                meas: match[9] || '-',
                status: 'COMPLETE',
                editedByUser: false
            });
        }
    });

    // Fallback Parsing Strategy if strict regex didn't catch specific formatted tables
    if (items.length === 0) {
        let currentItem = null;
        lines.forEach((line) => {
            const poMatch = line.match(/\b(45\d{8}|40\d{8}|\d{10})\b/);
            const sapNoMatch = line.match(/\b([A-Z0-9]{6,12}(?:-[A-Z0-9]+)?)\b/i);
            
            if (poMatch || sapNoMatch) {
                if (currentItem && (currentItem.sapPo || currentItem.sapNo)) {
                    items.push(currentItem);
                }
                currentItem = {
                    id: items.length + 1,
                    sapPo: poMatch ? poMatch[1] : '',
                    sapNo: sapNoMatch ? sapNoMatch[1] : '',
                    description: line.replace(poMatch ? poMatch[0] : '', '').replace(sapNoMatch ? sapNoMatch[0] : '', '').trim(),
                    totalQty: '',
                    qtyPcs: '',
                    qtyCtns: '',
                    nw: '',
                    gw: '',
                    meas: '-',
                    status: 'INCOMPLETE',
                    editedByUser: false
                };
            }
        });
        if (currentItem) items.push(currentItem);
    }

    // Final Status Audit Check
    return items.map((item, idx) => {
        item.id = idx + 1;
        const isComplete = Boolean(item.sapPo && item.sapNo && item.description && item.totalQty);
        item.status = isComplete ? 'COMPLETE' : 'INCOMPLETE';
        return item;
    });
}

// OCR Engine Framework Placeholder (Prepared for Phase Extension)
async function processOCR(filePath) {
    // Structural Support for Scanned PDF / Images
    // Currently returns controlled fallback notice without breaking application
    return {
        isScanned: true,
        extractedText: "",
        notice: "Scanned PDF Detected. OCR framework initialized."
    };
}

// API: Upload & Process PDF
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, async (err) => {
        if (err) {
            if (err.message === 'INVALID_FILE_TYPE') {
                return res.status(400).json({ success: false, message: 'รองรับเฉพาะไฟล์ PDF เท่านั้น' });
            }
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ PDF' });
        }

        const filePath = req.file.path;

        try {
            const dataBuffer = fs.readFileSync(filePath);
            
            // Function 2: Validation check (Readable & Non-empty)
            if (!dataBuffer || dataBuffer.length === 0) {
                fs.unlinkSync(filePath);
                return res.status(400).json({ success: false, message: 'ไฟล์ PDF ไม่มีข้อมูลหรือไม่สามารถเปิดได้' });
            }

            let pdfData;
            try {
                pdfData = await pdfParse(dataBuffer);
            } catch (pdfErr) {
                fs.unlinkSync(filePath);
                return res.status(400).json({ success: false, message: 'ไม่สามารถอ่านโครงสร้างไฟล์ PDF ได้ ไฟล์อาจเสียหาย' });
            }

            const rawText = pdfData.text ? pdfData.text.trim() : '';
            let extractedItems = [];
            let processType = 'TEXT_BASED';

            // Function 5: Text vs Scanned PDF Detection
            if (rawText.length > 30) {
                extractedItems = parsePackingListText(rawText);
            } else {
                processType = 'SCANNED_OCR_READY';
                await processOCR(filePath);
            }

            const documentId = generateDocumentId();

            // Function 8: Metadata Record
            const responsePayload = {
                success: true,
                metadata: {
                    documentId: documentId,
                    originalName: req.file.originalname,
                    uploadTimestamp: new Date().toISOString(),
                    fileSize: (req.file.size / 1024).toFixed(2) + ' KB',
                    mimeType: req.file.mimetype,
                    processType: processType,
                    processingStatus: 'PROCESSED'
                },
                items: extractedItems
            };

            return res.json(responsePayload);

        } catch (error) {
            console.error('Extraction Error:', error);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบในการอ่านข้อมูล PDF' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`================================================`);
    console.log(`PL Brand System Backend (Phase 1) Active`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`================================================`);
});