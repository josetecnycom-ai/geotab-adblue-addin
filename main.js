geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    let allDevices = [];
    let allStatusData = [];
    let calculatedResults = []; 

    return {
        initialize(api, state, callback) {
            const today = new Date();
            const lastMonth = new Date();
            lastMonth.setDate(today.getDate() - 30);

            document.getElementById("dateTo").value = today.toISOString().slice(0, 16);
            document.getElementById("dateFrom").value = lastMonth.toISOString().slice(0, 16);

            document.getElementById("refreshBtn").addEventListener("click", () => this.updateReport(api));
            document.getElementById("exportBtn").addEventListener("click", () => this.downloadCSV());
            document.getElementById("searchInput").addEventListener("input", (e) => this.filterAndRender(e.target.value.toLowerCase()));

            this.updateReport(api);
            callback();
        },

        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Calculando consumos y sumando registros históricos...</div>';

            const fromDate = document.getElementById("dateFrom").value;
            const toDate = document.getElementById("dateTo").value;

            try {
                const results = await api.multiCall([
                    ["Get", { typeName: "Device" }],
                    ["Get", { 
                        typeName: "StatusData", 
                        search: { 
                            diagnosticSearch: { id: DIAGNOSTIC_ADBLUE_ID },
                            fromDate: fromDate,
                            toDate: toDate
                        } 
                    }]
                ]);

                allDevices = results[0];
                allStatusData = results[1];
                this.processData();
                this.renderCards(allDevices);
            } catch (error) {
                container.innerHTML = `<p style="color:red">Error API: ${error.message}</p>`;
            }
        },

        processData() {
    const fromLimit = new Date(document.getElementById("dateFrom").value);
    const toLimit = new Date(document.getElementById("dateTo").value);

    calculatedResults = allDevices.map(device => {
        // 1. Lógica de Sensores (se mantiene igual)
        const data = allStatusData
            .filter(d => d.device.id === device.id)
            .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        let totalSensorConsumed = 0;
        let lastLevel = null;
        data.forEach(p => {
            if (lastLevel !== null) {
                const diff = lastLevel - p.data;
                if (diff > 0) totalSensorConsumed += diff;
            }
            lastLevel = p.data;
        });

        // 2. LÓGICA DE SUMATORIA CORREGIDA
        let sumaLitrosPeriodo = 0;
        let conteoRegistros = 0;

        if (device.comment) {
            // Regex mejorada: busca el patrón [DD/MM, HH:mm -> XX L]
            // Ignora los separadores "|" y espacios extra
            const regexGlobal = /\[(\d{1,2})\/(\d{1,2}),?\s*\d{1,2}:\d{1,2}\s*->\s*(\d+)\s*L\]/g;
            let match;

            while ((match = regexGlobal.exec(device.comment)) !== null) {
                const dia = parseInt(match[1]);
                const mes = parseInt(match[2]) - 1; // Enero es 0
                const litros = parseInt(match[3]);

                // Creamos fecha del registro usando el año del filtro "Hasta" 
                // para evitar errores de cambio de año
                const fechaRegistro = new Date(toLimit.getFullYear(), mes, dia);

                // Si la fecha del registro es válida y entra en el rango
                if (fechaRegistro >= fromLimit && fechaRegistro <= toLimit) {
                    sumaLitrosPeriodo += litros;
                    conteoRegistros++;
                }
            }
        }

        return {
            id: device.id,
            name: device.name,
            plate: device.licensePlate || "N/A",
            currentLevel: data.length ? Math.round(data[data.length - 1].data) : null,
            consumed: Math.round(totalSensorConsumed * 10) / 10,
            hasData: data.length > 0,
            totalManualLiters: sumaLitrosPeriodo,
            numManualRecords: conteoRegistros
        };
    });
}

        renderCards(devicesToRender) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";
            let criticals = 0;

            devicesToRender.forEach(dev => {
                const res = calculatedResults.find(r => r.id === dev.id);
                if (!res) return;

                if (res.currentLevel !== null && res.currentLevel < 10) criticals++;

                let status = "no-data";
                if (res.currentLevel !== null) {
                    status = res.currentLevel < 10 ? "critical" : (res.currentLevel < 20 ? "warning" : "ok");
                }

                const card = document.createElement("div");
                card.className = `vehicle-card ${status}`;
                
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between">
                        <strong>${res.name}</strong>
                    </div>
                    <p style="font-size:0.8em; color:#666; margin:5px 0;">Matrícula: ${res.plate}</p>
                    
                    <div style="margin:10px 0">
                        <small>Nivel Actual: ${res.currentLevel ?? '--'}%</small>
                        <div style="background:#eee; height:8px; border-radius:4px">
                            <div style="width:${res.currentLevel || 0}%; background:${this.getBarColor(res.currentLevel)}; height:100%; border-radius:4px"></div>
                        </div>
                    </div>

                    <div class="manual-refill-box" style="border-left-color: ${res.totalManualLiters > 0 ? '#27ae60' : '#ccc'}">
                        <div style="font-size: 0.75em; color: #333; font-weight:bold; margin-bottom:2px;">
                            📋 Rellenos en este periodo
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:end;">
                            <span style="font-size: 1.3em; font-weight:bold; color: #2e7d32;">${res.totalManualLiters} Litros</span>
                            <span style="font-size: 0.7em; color: #666;">${res.numManualRecords} reportes</span>
                        </div>
                    </div>

                    <div class="consumption-box">
                        <small>Consumo Sensor (Estimado %):</small>
                        <div style="font-size:1.2em; font-weight:bold; color:#2440b2;">
                            ${res.hasData ? res.consumed + '%' : 'Sin datos'}
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById("count-critical").innerText = criticals;
        },

        getBarColor(lvl) {
            if (lvl === null) return "#ccc";
            if (lvl < 10) return "#e74c3c";
            if (lvl < 20) return "#f39c12";
            return "#27ae60";
        },

        filterAndRender(term) {
            const filtered = allDevices.filter(d => d.name.toLowerCase().includes(term) || (d.licensePlate || "").toLowerCase().includes(term));
            this.renderCards(filtered);
        },

        downloadCSV() {
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Nivel %,Consumo %,Total Litros Manual (Periodo),Num Reportes\n";
            calculatedResults.forEach(r => {
                csv += `"${r.name}","${r.plate}","${r.currentLevel ?? ''}","${r.consumed}","${r.totalManualLiters}","${r.numManualRecords}"\n`;
            });
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `AdBlue_Detalle.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
};

