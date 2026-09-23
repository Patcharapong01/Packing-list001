document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileDetails = document.getElementById('fileDetails');
    const fileNameDisplay = document.getElementById('fileName');
    const fileSizeDisplay = document.getElementById('fileSize');
    const cancelBtn = document.getElementById('cancelBtn');
    const processBtn = document.getElementById('processBtn');

    const uploadSection = document.getElementById('uploadSection');
    const statusSection = document.getElementById('statusSection');
    const previewSection = document.getElementById('previewSection');

    const statusText = document.getElementById('statusText');
    const statusSubText = document.getElementById('statusSubText');

    let selectedFile = null;
    let extractedDataItems = [];

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50/50');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    function handleFileSelection(file) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            Swal.fire({
                icon: 'error',
                title: 'ข้อผิดพลาด',
                text: 'รองรับเฉพาะไฟล์ PDF เท่านั้น',
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        selectedFile = file;
        fileNameDisplay.textContent = file.name;
        fileSizeDisplay.textContent = (file.size / 1024).toFixed(2) + ' KB';
        
        dropZone.classList.add('hidden');
        fileDetails.classList.remove('hidden');
    }

    cancelBtn.addEventListener('click', resetUploadForm);

    function resetUploadForm() {
        selectedFile = null;
        fileInput.value = '';
        fileDetails.classList.add('hidden');
        dropZone.classList.remove('hidden');
    }

    processBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        uploadSection.classList.add('hidden');
        statusSection.classList.remove('hidden');
        
        updateStatus('กำลังอ่านไฟล์...', 'อ่านไฟล์ PDF และอัปโหลดไปยังระบบ');

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            setTimeout(() => updateStatus('Extract ข้อมูล...', 'ค้นหา SAP PO, SAP NO. และรายการสินค้า'), 600);
            setTimeout(() => updateStatus('ตรวจสอบข้อมูล...', 'ตรวจสอบความสมบูรณ์ของค่าที่สกัดได้'), 1200);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'เกิดข้อผิดพลาดในการประมวลผล');
            }

            renderPreview(result.metadata, result.items);

        } catch (error) {
            statusSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            
            Swal.fire({
                icon: 'error',
                title: 'ไม่สามารถอ่านข้อมูลได้',
                text: error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์',
                confirmButtonColor: '#2563eb'
            });
        }
    });

    function updateStatus(mainText, subText) {
        statusText.textContent = mainText;
        statusSubText.textContent = subText;
    }

    function renderPreview(metadata, items) {
        statusSection.classList.add('hidden');
        previewSection.classList.remove('hidden');

        document.getElementById('metaDocId').textContent = metadata.documentId;
        document.getElementById('metaFileName').textContent = metadata.originalName;
        document.getElementById('metaUploadTime').textContent = new Date(metadata.uploadTimestamp).toLocaleString('th-TH');

        extractedDataItems = items;
        buildTableRows();
    }

    function buildTableRows() {
        const tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';

        if (extractedDataItems.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="p-8 text-center text-slate-400">
                        ไม่พบข้อมูลในเอกสาร PDF นี้ หรือโครงสร้าง PDF อ่านยากเกินไป
                    </td>
                </tr>
            `;
            return;
        }

        extractedDataItems.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition-colors border-b border-slate-100";

            const isComplete = item.status === 'COMPLETE';
            const statusBadge = isComplete 
                ? `<span class="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded text-[11px] font-medium"><i data-lucide="check" class="w-3 h-3"></i> ครบ</span>`
                : `<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-medium"><i data-lucide="alert-triangle" class="w-3 h-3"></i> บางส่วน</span>`;

            const editedFlag = item.editedByUser ? `<span class="text-[10px] text-blue-600 font-normal block">(แก้ไขแล้ว)</span>` : '';

            tr.innerHTML = `
                <td class="p-3 text-center text-slate-400 font-mono">${index + 1}</td>
                <td class="p-2"><input type="text" data-field="sapPo" value="${item.sapPo}" class="w-full bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2"><input type="text" data-field="sapNo" value="${item.sapNo}" class="w-full bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2"><input type="text" data-field="description" value="${item.description}" class="w-full bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300"></td>
                <td class="p-2 text-right"><input type="text" data-field="totalQty" value="${item.totalQty}" class="w-full text-right bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2 text-right"><input type="text" data-field="qtyPcs" value="${item.qtyPcs}" class="w-full text-right bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2 text-right"><input type="text" data-field="qtyCtns" value="${item.qtyCtns}" class="w-full text-right bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2 text-right"><input type="text" data-field="nw" value="${item.nw}" class="w-full text-right bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2 text-right"><input type="text" data-field="gw" value="${item.gw}" class="w-full text-right bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-2"><input type="text" data-field="meas" value="${item.meas}" class="w-full bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-1 border border-transparent hover:border-slate-300 font-mono"></td>
                <td class="p-3 text-center">${statusBadge} ${editedFlag}</td>
            `;

            const inputs = tr.querySelectorAll('input');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    extractedDataItems[index][field] = e.target.value;
                    extractedDataItems[index].editedByUser = true;
                    
                    const itemRef = extractedDataItems[index];
                    if (itemRef.sapPo && itemRef.sapNo && itemRef.description && itemRef.totalQty) {
                        itemRef.status = 'COMPLETE';
                    }
                    buildTableRows();
                });
            });

            tbody.appendChild(tr);
        });

        lucide.createIcons();
    }

    document.getElementById('confirmDataBtn').addEventListener('click', () => {
        Swal.fire({
            icon: 'success',
            title: 'ยืนยันข้อมูลสำเร็จ',
            text: 'ข้อมูล Packing List ถูกตรวจสอบเรียบร้อยพร้อมเข้าสู่ขั้นตอนต่อไป',
            confirmButtonColor: '#059669'
        });
    });
});
