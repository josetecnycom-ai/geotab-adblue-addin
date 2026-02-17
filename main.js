geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    const DIAGNOSTIC_ODOMETER_ID = "DiagnosticOdometerAdjustmentId";

    let allDevices = [];
    let allStatusData = [];
    let allOdometerData = [];
    let processedVehicles = []; // Guardaremos solo los que tienen actividad

    return {
        initialize(api, state, callback) {
            const today = new Date();
            const lastMonth = new Date();
            lastMonth.setDate(today.getDate() - 30);

            document.getElementById("dateTo").value = today.toISOString().slice(0, 16);
            document.getElementById("dateFrom").value = lastMonth.toISOString().slice(0, 16);

            document.getElementById("refreshBtn").addEventListener("click", () => this.updateReport(api));
            document.getElementById("exportBtn").addEventListener("click", () => this.downloadRefillEventsCSV());
            document.getElementById("searchInput").addEventListener("input", (e) => this.filterVisuals(e.target.value.toLowerCase()));

            this.updateReport(api);
            callback();
        },

        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Buscando eventos de carga (Manuales y Sensor)...</div>';

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
                    }],
                    ["Get", { 
                        typeName: "StatusData", 
                        search: { 
                            diagnosticSearch: { id: DIAGNOSTIC_ODOMETER_ID },
                            fromDate: fromDate,
                            toDate: toDate
                        } 
                    }]
                ]);

                allDevices = results[0];
                allStatusData = results[1];
                allOdometerData = results[2];
                
                this.analyzeRefillEvents();
                this.renderCards(processedVehicles);
            } catch (error) {
                container.innerHTML = `<p style="color:red">Error API: ${error.message}</p>`;
                console.error(error);
            }
        },

        analyzeRefillEvents() {
            const fromLimit = new Date(document.getElementById("dateFrom").value);
            const toLimit = new Date(document.getElementById("dateTo").value);

            // Reiniciamos la lista procesada
            processedVehicles = [];

            allDevices.forEach(device => {
                // 1. Preparar datos y ordenar cronológicamente
                const adBlueData = allStatusData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                const odoData = allOdometerData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                // 2. Detectar Repostajes MANUALES
                let manualEvents = [];
                if (device.comment) {
                    const regex = /\[(\d{1,2})\/(\d{1,2})[^->]*->\s*(\d+)\s*L\]/g;
                    let match;
                    while ((match = regex.exec(device.comment)) !== null) {
                        const dia = parseInt(match[1]);
                        const mes = parseInt(match[2]) - 1;
                        const litros = parseInt(match[3]);
                        
                        let fecha = new Date(toLimit.getFullYear(), mes, dia, 12, 0);
                        if (fecha > toLimit) fecha.setFullYear(fecha.getFullYear() - 1);

                        if (fecha >= fromLimit && fecha <= toLimit) {
                            manualEvents.push({
                                type: 'MANUAL',
                                date: fecha,
                                liters: litros,
                                matched: false
                            });
                        }
                    }
                }

                // --- 3. NUEVA LÓGICA DE SENSOR AGRUPADO ---
                let consolidatedSensorEvents = [];
                let currentRefill = null;
                const GROUPING_WINDOW_MS = 20 * 60 * 1000; // 20 minutos para agrupar subidas

                for (let i = 1; i < adBlueData.length; i++) {
                    const prev = adBlueData[i-1];
                    const curr = adBlueData[i];
                    const diff = curr.data - prev.data;
                    const timeDiff = new Date(curr.dateTime) - new Date(prev.dateTime);

                    // Solo nos interesan las subidas (repostajes)
                    if (diff > 0) {
                        const eventDate = new Date(curr.dateTime);

                        if (currentRefill) {
                            // Ya estamos traqueando un repostaje. ¿Esta nueva subida es parte del mismo?
                            // Si ha pasado menos de X tiempo desde la última actualización de este evento
                            if ((eventDate - currentRefill.lastUpdate) < GROUPING_WINDOW_MS) {
                                // Es el mismo repostaje: actualizamos el nivel final y la hora
                                currentRefill.endLevel = curr.data;
                                currentRefill.percentJump = currentRefill.endLevel - currentRefill.startLevel;
                                currentRefill.date = eventDate; // Nos quedamos con la hora de finalización
                                currentRefill.lastUpdate = eventDate;
                            } else {
                                // Ha pasado mucho tiempo, cerramos el anterior y empezamos uno nuevo
                                if (currentRefill.percentJump > 5) { // Filtro de ruido: Solo si subió > 5% total
                                    consolidatedSensorEvents.push(currentRefill);
                                }
                                currentRefill = {
                                    type: 'SENSOR',
                                    date: eventDate,
                                    lastUpdate: eventDate,
                                    startLevel: prev.data,
                                    endLevel: curr.data,
                                    percentJump: diff
                                };
                            }
                        } else {
                            // Nuevo posible repostaje
                            currentRefill = {
                                type: 'SENSOR',
                                date: eventDate,
                                lastUpdate: eventDate,
                                startLevel: prev.data,
                                endLevel: curr.data,
                                percentJump: diff
                            };
                        }
                    }
                }
                // Añadir el último si quedó pendiente
                if (currentRefill && currentRefill.percentJump > 5) {
                    consolidatedSensorEvents.push(currentRefill);
                }

                // 4. CRUZAR DATOS (Algoritmo de Fusión Mejorado)
                let finalEvents = [];
                
                // A) Procesar manuales e intentar vincular con los eventos CONSOLIDADOS del sensor
                manualEvents.forEach(mEvent => {
                    // Buscamos coincidencia en una ventana amplia (± 6 horas)
                    const sMatch = consolidatedSensorEvents.find(s => Math.abs(s.date - mEvent.date) < (6 * 3600000));
                    
                    let odometer = this.getOdometerAtDate(mEvent.date, odoData);

                    if (sMatch) {
                        // Coincidencia encontrada
                        let tankCap = Math.round(mEvent.liters / (sMatch.percentJump / 100));
                        finalEvents.push({
                            date: sMatch.date, 
                            type: 'VERIFICADO', 
                            liters: mEvent.liters,
                            percentJump: sMatch.percentJump,
                            tankCapacity: tankCap,
                            odometer: this.getOdometerAtDate(sMatch.date, odoData) 
                        });
                        sMatch.matched = true; 
                    } else {
                        // Solo manual
                        finalEvents.push({
                            date: mEvent.date,
                            type: 'MANUAL_SOLO',
                            liters: mEvent.liters,
                            percentJump: null,
                            tankCapacity: null,
                            odometer: odometer
                        });
                    }
                });

                // B) Añadir eventos de sensor sobrantes (No reportados manualmente)
                consolidatedSensorEvents.filter(s => !s.matched).forEach(sEvent => {
                    let estimatedLiters = Math.round((sEvent.percentJump / 100) * 80); 
                    
                    finalEvents.push({
                        date: sEvent.date,
                        type: 'SENSOR_SOLO', 
                        liters: estimatedLiters,
                        percentJump: sEvent.percentJump,
                        tankCapacity: 80, 
                        odometer: this.getOdometerAtDate(sEvent.date, odoData)
                    });
                });

                finalEvents.sort((a, b) => a.date - b.date);

                if (finalEvents.length > 0) {
                    const totalLiters = finalEvents.reduce((acc, curr) => acc + curr.liters, 0);
                    
                    // Aseguramos que haya un odómetro válido aunque sea buscando hacia atrás
                    let lastOdo = 0;
                    if(finalEvents.length > 0) {
                         lastOdo = finalEvents[finalEvents.length-1].odometer;
                         // Si da 0, intentamos coger el último dato conocido del vehículo
                         if (lastOdo === 0 && odoData.length > 0) {
                             lastOdo = Math.round(odoData[odoData.length-1].data / 1000);
                         }
                    }

                    processedVehicles.push({
                        id: device.id,
                        name: device.name,
                        plate: device.licensePlate || "N/A",
                        events: finalEvents,
                        totalRefills: finalEvents.length,
                        totalLiters: totalLiters,
                        lastOdometer: lastOdo
                    });
                }
            });
        },

        getOdometerAtDate(targetDate, odoList) {
            if (!odoList || odoList.length === 0) return 0;
            // Buscar el registro más cercano en tiempo
            const closest = odoList.reduce((prev, curr) => {
                return (Math.abs(new Date(curr.dateTime) - targetDate) < Math.abs(new Date(prev.dateTime) - targetDate) ? curr : prev);
            });
            return Math.round(closest.data / 1000); // Convertir metros a KM
        },

        renderCards(vehicles) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";
            let grandTotal = 0;

            if (vehicles.length === 0) {
                container.innerHTML = `<div style="text-align:center; padding:20px; width:100%">No se detectaron repostajes en este periodo para ningún vehículo.</div>`;
                return;
            }

            vehicles.forEach(v => {
                grandTotal += v.totalLiters;

                const card = document.createElement("div");
                card.className = "vehicle-card ok"; // Ponemos estado OK por defecto si hay datos
                
                // Construir mini-lista de últimos eventos para visualización rápida
                let eventsHtml = v.events.slice(-3).map(e => 
                    `<div style="font-size:0.75em; border-bottom:1px solid #eee; padding:2px 0; display:flex; justify-content:space-between">
                        <span>${e.date.toLocaleDateString()} (${e.type === 'VERIFICADO' ? '✓' : (e.type === 'SENSOR_SOLO' ? '⚠ Sensor' : '✎ Man')})</span>
                        <b>${e.liters} L</b>
                    </div>`
                ).join('');

                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div>
                            <strong>${v.name}</strong>
                            <p style="font-size:0.8em; color:#666; margin:2px 0;">${v.plate}</p>
                        </div>
                        <div style="text-align:right; background:#e8f5e9; padding:5px 8px; border-radius:5px; color:#2e7d32;">
                            <span style="font-size:1.2em; font-weight:bold">${v.totalRefills}</span>
                            <small style="display:block; font-size:0.6em; text-transform:uppercase;">Llenados</small>
                        </div>
                    </div>
                    
                    <div class="manual-refill-box" style="margin-top:10px; padding: 10px; background:#f9f9f9; border-radius:5px; border:1px solid #eee;">
                        <div style="font-size:0.8em; color:#666; margin-bottom:5px;">Últimos repostajes:</div>
                        ${eventsHtml}
                        ${v.events.length > 3 ? '<div style="font-size:0.7em; text-align:center; color:#999">... ver excel para más</div>' : ''}
                    </div>

                    <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:0.85em; color:#333;">
                        <span>Total: <b>${v.totalLiters} L</b></span>
                        <span>Km: <b>${v.lastOdometer}</b></span>
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById("total-manual-liters").innerText = grandTotal + " L";
        },

        downloadRefillEventsCSV() {
            // Cabecera optimizada para análisis en Excel
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Fecha Hora,Tipo Evento,Litros (L),Odometro (Km),Capacidad Tanque Calculada (L),Salto Sensor (%)\n";
            
            processedVehicles.forEach(veh => {
                veh.events.forEach(ev => {
                    const fechaStr = ev.date.toLocaleString();
                    const tankCap = ev.tankCapacity ? ev.tankCapacity : "N/A";
                    const jump = ev.percentJump ? ev.percentJump.toFixed(1) + "%" : "N/A";
                    
                    csv += `"${veh.name}","${veh.plate}","${fechaStr}","${ev.type}","${ev.liters}","${ev.odometer}","${tankCap}","${jump}"\n`;
                });
            });

            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `Bitacora_Llenados_AdBlue_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },
        
        filterVisuals(term) {
            const filtered = processedVehicles.filter(d => d.name.toLowerCase().includes(term) || (d.plate || "").toLowerCase().includes(term));
            this.renderCards(filtered);
        }
    };
};
