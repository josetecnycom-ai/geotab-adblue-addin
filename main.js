geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    let allDevices = [];
    let allStatusData = [];
    let calculatedResults = []; 
    let myChart = null; // Variable para controlar la instancia del gráfico

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
            container.innerHTML = '<div class="loading-shimmer">Procesando datos...</div>';

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
                this.updateChart(); // Llamada al gráfico
            } catch (error) {
                container.innerHTML = `<p style="color:red">Error API: ${error.message}</p>`;
            }
        },

        processData() {
            const fromLimit = new Date(document.getElementById("dateFrom").value);
            const toLimit = new Date(document.getElementById("dateTo").value);

            calculatedResults = allDevices.map(device => {
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

                let sumaLitrosPeriodo = 0;
                let conteoRegistros = 0;
                if (device.comment) {
                    const regexGlobal = /\[(\d{1,2})\/(\d{1,2})[^->]*->\s*(\d+)\s*L\]/g;
                    let match;
                    while ((match = regexGlobal.exec(device.comment)) !== null) {
                        const dia = parseInt(match[1]);
                        const mes = parseInt(match[2]) - 1;
                        const litros = parseInt(match[3]);
                        const fechaRegistro = new Date(toLimit.getFullYear(), mes, dia);
                        if (fechaRegistro > toLimit) fechaRegistro.setFullYear(fechaRegistro.getFullYear() - 1);

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
                    totalManualLiters: sumaLitrosPeriodo,
                    numManualRecords: conteoRegistros
                };
            });
        },

        updateChart() {
            const ctx = document.getElementById('comparisonChart').getContext('2d');
            
            // Si el gráfico ya existe, lo destruimos para recargarlo
            if (myChart) myChart.destroy();

            // Filtramos solo los vehículos que tienen algún dato para no saturar el gráfico
            const chartData = calculatedResults.filter(r => r.consumed > 0 || r.totalManualLiters > 0).slice(0, 15);

            myChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: chartData.map(r => r.name),
                    datasets: [
                        {
                            label: 'Consumo Sensor (%)',
                            data: chartData.map(r => r.consumed),
                            backgroundColor: 'rgba(36, 64, 178, 0.6)',
                            borderColor: 'rgba(36, 64, 178, 1)',
                            borderWidth: 1,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Litros Manuales (L)',
                            data: chartData.map(r => r.totalManualLiters),
                            backgroundColor: 'rgba(39, 174, 96, 0.6)',
                            borderColor: 'rgba(39, 174, 96, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { 
                            type: 'linear', 
                            position: 'left',
                            title: { display: true, text: 'Sensor %' }
                        },
                        y1: { 
                            type: 'linear', 
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: 'Litros (L)' }
                        }
                    }
                }
            });
        },

        renderCards(devicesToRender) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";
            let criticals = 0;
            let grandTotalManual = 0;

            devicesToRender.forEach(dev => {
                const res = calculatedResults.find(r => r.id === dev.id);
                if (!res) return;

                if (res.currentLevel !== null && res.currentLevel < 10) criticals++;
                grandTotalManual += res.totalManualLiters;

                let status = res.currentLevel !== null ? (res.currentLevel < 10 ? "critical" : (res.currentLevel < 20 ? "warning" : "ok")) : "no-data";

                const card = document.createElement("div");
                card.className = `vehicle-card ${status}`;
                card.innerHTML = `
                    <strong>${res.name}</strong>
                    <p style="font-size:0.8em; color:#666; margin:4px 0;">${res.plate}</p>
                    <div class="manual-refill-box">
                        <span style="font-size: 1.1em; font-weight:bold; color: #2e7d32;">${res.totalManualLiters} L</span>
                        <small style="display:block; color:#666">${res.numManualRecords} reportes</small>
                    </div>
                    <div class="consumption-box">
                        <small>Sensor: ${res.consumed}%</small>
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById("count-critical").innerText = criticals;
            document.getElementById("total-manual-liters").innerText = grandTotalManual + " L";
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
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Consumo Sensor %,Total Litros Manual,Reportes\n";
            calculatedResults.forEach(r => {
                csv += `"${r.name}","${r.plate}","${r.consumed}","${r.totalManualLiters}","${r.numManualRecords}"\n`;
            });
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `Reporte_AdBlue.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
};
