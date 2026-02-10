geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    let allDevices = [];
    let allStatusData = [];
    let calculatedResults = []; // Guardamos los cálculos para el CSV

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
            container.innerHTML = '<div class="loading-shimmer">Calculando consumos reales...</div>';

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
            calculatedResults = allDevices.map(device => {
                const data = allStatusData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                let totalConsumed = 0;
                let refillsCount = 0;
                let lastLevel = null;

                data.forEach(p => {
                    if (lastLevel !== null) {
                        const diff = lastLevel - p.data;
                        if (diff > 0) {
                            // Es un consumo normal
                            totalConsumed += diff;
                        } else if (diff < -20) {
                            // Es una subida de más del 20%, lo contamos como relleno
                            refillsCount++;
                        }
                    }
                    lastLevel = p.data;
                });

                return {
                    id: device.id,
                    name: device.name,
                    plate: device.licensePlate || "N/A",
                    currentLevel: data.length ? Math.round(data[data.length - 1].data) : null,
                    consumed: Math.round(totalConsumed * 10) / 10,
                    refills: refillsCount,
                    hasData: data.length > 0
                };
            });
        },

        renderCards(devicesToRender) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";
            let criticals = 0;
            let sumConsumed = 0;
            let countWithData = 0;

            devicesToRender.forEach(dev => {
                const res = calculatedResults.find(r => r.id === dev.id);
                if (!res) return;

                if (res.currentLevel !== null && res.currentLevel < 10) criticals++;
                if (res.hasData) {
                    sumConsumed += res.consumed;
                    countWithData++;
                }

                let status = "no-data";
                if (res.currentLevel !== null) {
                    status = res.currentLevel < 10 ? "critical" : (res.currentLevel < 20 ? "warning" : "ok");
                }

                const card = document.createElement("div");
                card.className = `vehicle-card ${status}`;
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between">
                        <strong>${res.name}</strong>
                        ${res.refills > 0 ? `<span class="fill-badge">⛽ ${res.refills} Rellenos</span>` : ''}
                    </div>
                    <p style="font-size:0.8em; color:#666; margin:5px 0;">Matrícula: ${res.plate}</p>
                    
                    <div style="margin:10px 0">
                        <small>Nivel Actual: ${res.currentLevel ?? '--'}%</small>
                        <div style="background:#eee; height:8px; border-radius:4px">
                            <div style="width:${res.currentLevel || 0}%; background:${this.getBarColor(res.currentLevel)}; height:100%; border-radius:4px"></div>
                        </div>
                    </div>

                    <div class="consumption-box">
                        <small>Consumo en el periodo:</small>
                        <div style="font-size:1.2em; font-weight:bold; color:#2440b2;">
                            ${res.hasData ? res.consumed + '%' : 'Sin datos'}
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById("count-critical").innerText = criticals;
            document.getElementById("avg-consumption").innerText = countWithData > 0 ? (sumConsumed/countWithData).toFixed(1) + "%" : "0%";
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
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Nivel Actual (%),Consumo Total (%),Num Rellenos\n";
            calculatedResults.forEach(r => {
                csv += `"${r.name}","${r.plate}","${r.currentLevel ?? ''}","${r.consumed}","${r.refills}"\n`;
            });
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `Consumo_AdBlue_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
};


