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

// Advanced Parsing Engine for Packing Lists
function parsePackingListText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];

    // Keywords to ignore (Header, Footer, Addresses, Terms)
    const ignoreKeywords = [
        'INVOICE', 'PACKING LIST', 'SHIP TO', 'SOLD TO', 'PAGE', 'TOTAL', 
        'DESCRIPTION', 'QUANTITY', 'WEIGHT', 'MEASUREMENT', 'ATTN:', 'TEL:', 
        'FAX:', 'REMARK', 'DOKMAI', 'PRAVEJ', 'BANGKOK', 'SECTION', 'SOI'
    ];

    lines.forEach((line) => {
        const upper = line.toUpperCase();

        // 1. Skip non-data header/footer lines
        const isHeader = ignoreKeywords.some(kw => upper.includes(kw));
        if (isHeader) return;

        // 2. Try to locate SAP PO (8-10 digit numbers usually starting with 40, 45, etc.)
        const poMatch = line.match(/\b(4[05]\d{8}|\d{8,10})\b/);
        const sapPo = poMatch ? poMatch[1] : '';

        // Clean line from SAP PO to prevent duplicate parsing
        const cleanLine = poMatch ? line.replace(poMatch[0], '').trim() : line;

        // 3. Tokenize remaining line by multiple spaces or tabs
        const segments = cleanLine.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);

        // 4. Extract Quantities / Numbers (e.g. 1,000, 500 PCS, 20 CTNS, 15.5 KG)
        const qtyMatch = line.match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s*(PCS|SET|CTN|BOX)?\b/i);
        const numbersInLine = line.match(/\b\d+(?:\.\d+)?\b/g) || [];

        let sapNo = '';
        let description = '';
        let totalQty = qtyMatch ? qtyMatch[1].replace(/,/g, '') : '';
        let qtyCtns = '';
        let nw = '';
        let gw = '';
        let meas = '-';

        if (segments.length >= 2) {
            sapNo = segments[0];
            description = segments[1];
            if (segments.length >= 3 && !totalQty) {
                totalQty = segments[2].replace(/[^\d]/g, '');
            }
        } else {
            // Fallback: Word array parsing
            const words = cleanLine.split(/\s+/);
            if (words.length >= 2) {
                sapNo = words[0];
                description = words.slice(1, words.length - (numbersInLine.length || 0)).join(' ');
            }
        }

        // Try extracting weights from trailing numbers
        if (numbersInLine.length >= 2) {
            nw = numbersInLine[numbersInLine.length - 2] || '';
            gw = numbersInLine[numbersInLine.length - 1] || '';
        }

        // Validate if row contains meaningful product data
        if ((sapNo.length >= 2 || sapPo) && description.length >= 2) {
            items.push({
                id: items.length + 1,
                sapPo: sapPo,
                sapNo: sapNo,
                description: description,
                totalQty: totalQty,
                qtyPcs: totalQty,
                qtyCtns: qtyCtns,
                nw: nw,
                gw: gw,
                meas: meas,
                status: (sapPo && sapNo && description && totalQty) ? 'COMPLETE' : 'INCOMPLETE',
                editedByUser: false
            });
        }
    });

    return items;
}

// Placeholder for OCR framework
async function processOCR(filePath) {
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

            if (rawText.length > 20) {
                extractedItems = parsePackingListText(rawText);
            } else {
                processType = 'SCANNED_OCR_READY';
                await processOCR(filePath);
            }

            const documentId = generateDocumentId();

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
    console.log(`URL: http://localhost:3000`);
    console.log(`================================================`);
});