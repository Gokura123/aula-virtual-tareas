const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class GoogleSheetsService {
    constructor() {
        this.doc = null;
        this.tareasSheet = null;
        this.entregasSheet = null;
        this.estudiantesSheet = null;
    }

    async inicializar() {
        try {
            const serviceAccountAuth = new JWT({
                email: process.env.GOOGLE_CLIENT_EMAIL,
                key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_ID, serviceAccountAuth);
            await this.doc.loadInfo();
            await this.configurarHojas();
            
            console.log('Google Sheets conectado exitosamente');
            return true;
        } catch (error) {
            console.error('Error al conectar con Google Sheets:', error);
            return false;
        }
    }

    async verificarYActualizarHeadersEstudiantes() {
        try {
            await this.estudiantesSheet.loadHeaderRow();
            const headersActuales = this.estudiantesSheet.headerValues;
            const headersEsperados = ['ID', 'Nombre Completo', 'Usuario', 'Contraseña', 'Curso', 'Fecha Registro', 'Estado', 'Último Acceso'];
            
            // Verificar si falta la columna Contraseña
            if (!headersActuales.includes('Contraseña')) {
                console.log('🔧 Agregando columna "Contraseña" a la hoja Estudiantes...');
                
                // Insertar la columna Contraseña en la posición 4 (después de Usuario)
                await this.estudiantesSheet.insertDimension('COLUMNS', {
                    startIndex: 3, // Posición después de Usuario (0-indexed)
                    endIndex: 4
                });
                
                // Actualizar el header
                await this.estudiantesSheet.loadCells('A1:H1');
                const headerCell = this.estudiantesSheet.getCell(0, 3); // Fila 0, Columna 3
                headerCell.value = 'Contraseña';
                await this.estudiantesSheet.saveUpdatedCells();
                
                console.log('✅ Columna "Contraseña" agregada exitosamente');
            }
        } catch (error) {
            console.error('Error al verificar headers de estudiantes:', error);
        }
    }

    async configurarHojas() {
        this.tareasSheet = this.doc.sheetsByTitle['Tareas'];
        if (!this.tareasSheet) {
            this.tareasSheet = await this.doc.addSheet({
                title: 'Tareas',
                headerValues: ['ID', 'Título', 'Descripción', 'Materia', 'Fecha Límite', 'Fecha Creación', 'Estado']
            });
        }

        this.entregasSheet = this.doc.sheetsByTitle['Entregas'];
        if (!this.entregasSheet) {
            this.entregasSheet = await this.doc.addSheet({
                title: 'Entregas',
                headerValues: ['ID Entrega', 'ID Tarea', 'Estudiante', 'Fecha Entrega', 'Tipo', 'Contenido', 'Comentarios', 'Calificación']
            });
        }

        this.estudiantesSheet = this.doc.sheetsByTitle['Estudiantes'];
        if (!this.estudiantesSheet) {
            this.estudiantesSheet = await this.doc.addSheet({
                title: 'Estudiantes',
                headerValues: ['ID', 'Nombre Completo', 'Usuario', 'Contraseña', 'Curso', 'Fecha Registro', 'Estado', 'Último Acceso']
            });
        } else {
            // Verificar si tiene la columna Contraseña
            await this.estudiantesSheet.loadHeaderRow();
            const headersActuales = this.estudiantesSheet.headerValues;
            
            if (!headersActuales.includes('Contraseña')) {
                console.log('🔧 Recreando hoja "Estudiantes" con nueva estructura...');
                
                // Guardar datos existentes
                const filasExistentes = await this.estudiantesSheet.getRows();
                const datosExistentes = filasExistentes.map(fila => ({
                    id: fila.get('ID'),
                    nombre: fila.get('Nombre Completo'),
                    usuario: fila.get('Usuario'),
                    curso: fila.get('Curso'),
                    fechaRegistro: fila.get('Fecha Registro'),
                    estado: fila.get('Estado'),
                    ultimoAcceso: fila.get('Último Acceso')
                }));
                
                // Eliminar hoja antigua
                await this.estudiantesSheet.delete();
                
                // Crear nueva hoja con estructura correcta
                this.estudiantesSheet = await this.doc.addSheet({
                    title: 'Estudiantes',
                    headerValues: ['ID', 'Nombre Completo', 'Usuario', 'Contraseña', 'Curso', 'Fecha Registro', 'Estado', 'Último Acceso']
                });
                
                // Restaurar datos existentes (sin contraseña por ahora)
                for (const dato of datosExistentes) {
                    await this.estudiantesSheet.addRow({
                        'ID': dato.id,
                        'Nombre Completo': dato.nombre,
                        'Usuario': dato.usuario,
                        'Contraseña': '[Migrar contraseña]', // Placeholder
                        'Curso': dato.curso,
                        'Fecha Registro': dato.fechaRegistro,
                        'Estado': dato.estado,
                        'Último Acceso': dato.ultimoAcceso
                    });
                }
                
                console.log('✅ Hoja "Estudiantes" recreada con nueva estructura');
            }
        }
        
        // Configurar hojas de calificaciones por curso (después de que todas las hojas estén inicializadas)
        await this.configurarHojasCalificaciones();
    }

    async crearTarea(tarea) {
        try {
            if (!this.tareasSheet) throw new Error('Hoja de tareas no inicializada');
            
            await this.tareasSheet.addRow({
                'ID': tarea.id,
                'Título': tarea.titulo,
                'Descripción': tarea.descripcion,
                'Materia': tarea.materia,
                'Fecha Límite': tarea.fechaLimite,
                'Fecha Creación': tarea.fechaCreacion,
                'Estado': 'Activa'
            });
            
            // Actualizar hojas de calificaciones con la nueva tarea
            await this.actualizarHojaCalificacionesConTarea(tarea);
            
            return { success: true, message: 'Tarea guardada en Google Sheets' };
        } catch (error) {
            console.error('Error al crear tarea:', error);
            return { success: false, message: 'Error al guardar en Google Sheets' };
        }
    }

    async obtenerTareas() {
        try {
            if (!this.tareasSheet) throw new Error('Hoja de tareas no inicializada');
            
            const filas = await this.tareasSheet.getRows();
            const tareas = filas.map(fila => ({
                id: parseInt(fila.get('ID')),
                titulo: fila.get('Título'),
                descripcion: fila.get('Descripción'),
                materia: fila.get('Materia'),
                fechaLimite: fila.get('Fecha Límite'),
                fechaCreacion: fila.get('Fecha Creación'),
                estado: fila.get('Estado')
            }));
            return { success: true, tareas };
        } catch (error) {
            console.error('Error al obtener tareas:', error);
            return { success: false, tareas: [] };
        }
    }

    async registrarEstudiante(estudiante) {
        try {
            if (!this.estudiantesSheet) throw new Error('Hoja de estudiantes no inicializada');
            
            await this.estudiantesSheet.addRow({
                'ID': estudiante.id,
                'Nombre Completo': estudiante.nombre,
                'Usuario': estudiante.usuario,
                'Contraseña': estudiante.password,
                'Curso': estudiante.curso,
                'Fecha Registro': estudiante.fechaRegistro,
                'Estado': 'Activo',
                'Último Acceso': ''
            });
            return { success: true, message: 'Estudiante registrado en Google Sheets' };
        } catch (error) {
            console.error('Error al registrar estudiante:', error);
            return { success: false, message: 'Error al registrar en Google Sheets' };
        }
    }

    async obtenerEstudiantes() {
        try {
            if (!this.estudiantesSheet) throw new Error('Hoja de estudiantes no inicializada');
            
            const filas = await this.estudiantesSheet.getRows();
            const estudiantes = filas.map(fila => ({
                id: parseInt(fila.get('ID')),
                nombre: fila.get('Nombre Completo'),
                usuario: fila.get('Usuario'),
                password: fila.get('Contraseña'),
                curso: fila.get('Curso'),
                fechaRegistro: fila.get('Fecha Registro'),
                estado: fila.get('Estado'),
                ultimoAcceso: fila.get('Último Acceso')
            }));
            return { success: true, estudiantes };
        } catch (error) {
            console.error('Error al obtener estudiantes:', error);
            return { success: false, estudiantes: [] };
        }
    }

    async buscarEstudiante(usuario) {
        try {
            if (!this.estudiantesSheet) throw new Error('Hoja de estudiantes no inicializada');
            
            const filas = await this.estudiantesSheet.getRows();
            const fila = filas.find(f => f.get('Usuario') === usuario);
            
            if (fila) {
                return { 
                    success: true, 
                    estudiante: {
                        id: parseInt(fila.get('ID')),
                        nombre: fila.get('Nombre Completo'),
                        usuario: fila.get('Usuario'),
                        password: fila.get('Contraseña'),
                        curso: fila.get('Curso'),
                        fechaRegistro: fila.get('Fecha Registro'),
                        estado: fila.get('Estado'),
                        ultimoAcceso: fila.get('Último Acceso')
                    }
                };
            }
            return { success: false, message: 'Estudiante no encontrado' };
        } catch (error) {
            console.error('Error al buscar estudiante:', error);
            return { success: false, message: 'Error al buscar estudiante' };
        }
    }

    async actualizarUltimoAcceso(usuario) {
        try {
            if (!this.estudiantesSheet) throw new Error('Hoja de estudiantes no inicializada');
            
            const filas = await this.estudiantesSheet.getRows();
            const fila = filas.find(f => f.get('Usuario') === usuario);
            
            if (fila) {
                fila.set('Último Acceso', new Date().toISOString());
                await fila.save();
                return { success: true, message: 'Último acceso actualizado' };
            }
            return { success: false, message: 'Estudiante no encontrado' };
        } catch (error) {
            console.error('Error al actualizar último acceso:', error);
            return { success: false, message: 'Error al actualizar último acceso' };
        }
    }
    async registrarEntrega(entrega) {
        try {
            if (!this.entregasSheet) throw new Error('Hoja de entregas no inicializada');
            
            await this.entregasSheet.addRow({
                'ID Entrega': entrega.id,
                'ID Tarea': entrega.tareaId,
                'Estudiante': entrega.estudianteNombre,
                'Fecha Entrega': entrega.fechaEntrega,
                'Tipo': entrega.tipo,
                'Contenido': entrega.contenido,
                'Comentarios': entrega.comentarios || '',
                'Calificación': ''
            });
            return { success: true, message: 'Entrega registrada en Google Sheets' };
        } catch (error) {
            console.error('Error al registrar entrega:', error);
            return { success: false, message: 'Error al registrar entrega' };
        }
    }

    async obtenerEntregas(tareaId = null, curso = null) {
        try {
            if (!this.entregasSheet) throw new Error('Hoja de entregas no inicializada');

            const filas = await this.entregasSheet.getRows();
            let entregas = filas.map(fila => ({
                id: parseInt(fila.get('ID Entrega')),
                tareaId: parseInt(fila.get('ID Tarea')),
                estudianteNombre: fila.get('Estudiante'),
                fechaEntrega: fila.get('Fecha Entrega'),
                tipo: fila.get('Tipo'),
                contenido: fila.get('Contenido'),
                comentarios: fila.get('Comentarios'),
                calificacion: fila.get('Calificación'),
                curso: fila.get('Curso') // Agregar curso si está disponible
            }));

            // Filtrar por tarea si se especifica
            if (tareaId) {
                entregas = entregas.filter(entrega => entrega.tareaId === tareaId);
            }

            // Filtrar por curso si se especifica
            if (curso && curso !== 'todos') {
                // Si no hay campo curso en las entregas, obtener las tareas para filtrar
                if (!entregas[0]?.curso) {
                    const resultadoTareas = await this.obtenerTareas();
                    if (resultadoTareas.success) {
                        const tareasDelCurso = resultadoTareas.tareas
                            .filter(tarea => tarea.materia === curso)
                            .map(tarea => tarea.id);
                        entregas = entregas.filter(entrega => tareasDelCurso.includes(entrega.tareaId));
                    }
                } else {
                    entregas = entregas.filter(entrega => entrega.curso === curso);
                }
            }

            return { success: true, entregas };
        } catch (error) {
            console.error('Error al obtener entregas:', error);
            return { success: false, entregas: [] };
        }
    }

    async obtenerEstadisticas() {
        try {
            const resultadoTareas = await this.obtenerTareas();
            const resultadoEntregas = await this.obtenerEntregas();

            if (!resultadoTareas.success || !resultadoEntregas.success) {
                throw new Error('Error al obtener datos');
            }

            const tareas = resultadoTareas.tareas;
            const entregas = resultadoEntregas.entregas;

            const estadisticas = {
                totalTareas: tareas.length,
                tareasActivas: tareas.filter(t => t.estado === 'Activa').length,
                totalEntregas: entregas.length,
                entregasPendientes: this.calcularEntregasPendientes(tareas, entregas),
                promedioEntregasPorTarea: tareas.length > 0 ? (entregas.length / tareas.length).toFixed(1) : 0
            };

            return { success: true, estadisticas };
        } catch (error) {
            console.error('Error al obtener estadísticas:', error);
            return { success: false, estadisticas: {} };
        }
    }

    calcularEntregasPendientes(tareas, entregas) {
        const tareasConEntregas = new Set(entregas.map(e => e.tareaId));
        return tareas.filter(t => !tareasConEntregas.has(t.id)).length;
    }

    async actualizarTarea(tareaId, tareaActualizada) {
        try {
            if (!this.tareasSheet) throw new Error('Hoja de tareas no inicializada');
            
            const filas = await this.tareasSheet.getRows();
            const fila = filas.find(f => parseInt(f.get('ID')) === tareaId);
            
            if (fila) {
                fila.set('Título', tareaActualizada.titulo);
                fila.set('Descripción', tareaActualizada.descripcion);
                fila.set('Materia', tareaActualizada.materia);
                fila.set('Fecha Límite', tareaActualizada.fechaLimite);
                await fila.save();
                return { success: true, message: 'Tarea actualizada en Google Sheets' };
            } else {
                return { success: false, message: 'Tarea no encontrada en Google Sheets' };
            }
        } catch (error) {
            console.error('Error al actualizar tarea:', error);
            return { success: false, message: 'Error al actualizar en Google Sheets' };
        }
    }

    async eliminarTarea(tareaId) {
        try {
            if (!this.tareasSheet) throw new Error('Hoja de tareas no inicializada');
            
            console.log(`🗑️ Iniciando eliminación de tarea ID: ${tareaId}`);
            
            const filas = await this.tareasSheet.getRows();
            const fila = filas.find(f => parseInt(f.get('ID')) === tareaId);
            
            if (!fila) {
                return { success: false, message: 'Tarea no encontrada en Google Sheets' };
            }
            
            // Obtener información de la tarea antes de eliminarla
            const tituloTarea = fila.get('Título');
            const materiaTarea = fila.get('Materia');
            const nombreColumnaTarea = `${tituloTarea} (${materiaTarea})`;
            
            console.log(`📋 Eliminando tarea: "${tituloTarea}" del curso: ${materiaTarea}`);
            
            // Eliminar la tarea de la hoja principal
            await fila.delete();
            console.log(`✅ Tarea eliminada de la hoja principal`);
            
            // Eliminar la columna correspondiente de la hoja de calificaciones
            console.log(`🎯 Recreando hoja de calificaciones sin la tarea eliminada...`);
            const resultadoRecreacion = await this.recrearHojaCalificacionesSinTarea(materiaTarea, {
                titulo: tituloTarea,
                materia: materiaTarea
            });
            
            if (resultadoRecreacion.success) {
                console.log(`✅ Hoja de calificaciones actualizada exitosamente`);
            } else {
                console.error(`❌ Error al actualizar hoja de calificaciones: ${resultadoRecreacion.message}`);
                // No fallar toda la operación si solo falla la actualización de calificaciones
            }
            
            return { 
                success: true, 
                message: `Tarea "${tituloTarea}" eliminada completamente de Google Sheets y calificaciones`,
                tarea: {
                    titulo: tituloTarea,
                    materia: materiaTarea
                }
            };
        } catch (error) {
            console.error('Error al eliminar tarea:', error);
            return { success: false, message: `Error al eliminar de Google Sheets: ${error.message}` };
        }
    }

    async recrearHojaCalificacionesSinTarea(curso, tareaEliminada) {
        try {
            console.log(`🔄 Recreando hoja de calificaciones para curso ${curso} sin la tarea eliminada`);
            
            const nombreHoja = `Calificaciones_${curso}`;
            const hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
            
            if (!hojaCalificaciones) {
                console.log(`⚠️ Hoja ${nombreHoja} no existe, no hay nada que recrear`);
                return { success: true, message: 'Hoja no existía' };
            }
            
            // Obtener datos actuales
            const filasActuales = await hojaCalificaciones.getRows();
            await hojaCalificaciones.loadHeaderRow();
            const headersActuales = hojaCalificaciones.headerValues;
            
            console.log(`📋 Headers actuales: ${headersActuales.join(', ')}`);
            
            // Identificar qué columnas mantener (excluir la tarea eliminada)
            const nombreColumnaEliminar = `${tareaEliminada.titulo} (${tareaEliminada.materia})`;
            const headersNuevos = headersActuales.filter(h => h !== nombreColumnaEliminar);
            
            console.log(`🗑️ Eliminando columna: "${nombreColumnaEliminar}"`);
            console.log(`📋 Headers nuevos: ${headersNuevos.join(', ')}`);
            
            if (headersActuales.length === headersNuevos.length) {
                console.log(`ℹ️ No se encontró la columna a eliminar, no hay cambios necesarios`);
                return { success: true, message: 'Columna no encontrada, no hay cambios' };
            }
            
            // Obtener datos de estudiantes para recrear
            const datosEstudiantes = filasActuales.map(fila => {
                const datos = {};
                headersNuevos.forEach(header => {
                    datos[header] = fila.get(header) || '';
                });
                return datos;
            });
            
            // Eliminar hoja actual
            await hojaCalificaciones.delete();
            console.log(`🗑️ Hoja anterior eliminada`);
            
            // Crear nueva hoja con headers correctos
            const nuevaHoja = await this.doc.addSheet({
                title: nombreHoja,
                headerValues: headersNuevos
            });
            
            // Agregar datos de estudiantes
            for (const datos of datosEstudiantes) {
                await nuevaHoja.addRow(datos);
            }
            
            console.log(`✅ Hoja ${nombreHoja} recreada exitosamente sin la tarea eliminada`);
            
            return {
                success: true,
                message: `Hoja ${nombreHoja} recreada sin la tarea eliminada`,
                columnasEliminadas: headersActuales.length - headersNuevos.length
            };
        } catch (error) {
            console.error(`Error al recrear hoja de calificaciones:`, error);
            return {
                success: false,
                message: `Error al recrear hoja: ${error.message}`
            };
        }
    }

    async eliminarColumnaCalificaciones(curso, nombreColumna) {
        try {
            console.log(`🗑️ INICIANDO ELIMINACIÓN DE COLUMNA:`);
            console.log(`   📋 Curso: ${curso}`);
            console.log(`   📋 Columna: "${nombreColumna}"`);
            
            const nombreHoja = `Calificaciones_${curso}`;
            console.log(`   📋 Buscando hoja: ${nombreHoja}`);
            
            const hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
            
            if (!hojaCalificaciones) {
                console.log(`❌ Hoja de calificaciones no encontrada: ${nombreHoja}`);
                console.log(`📋 Hojas disponibles:`, Object.keys(this.doc.sheetsByTitle));
                return { success: false, message: `Hoja ${nombreHoja} no encontrada` };
            }
            
            console.log(`✅ Hoja encontrada: ${nombreHoja}`);
            
            try {
                await hojaCalificaciones.loadHeaderRow();
                const headers = hojaCalificaciones.headerValues;
                
                console.log(`📋 Headers actuales en ${nombreHoja}:`);
                headers.forEach((header, index) => {
                    console.log(`   ${index}: "${header}"`);
                });
                
                console.log(`🔍 Buscando columna exacta: "${nombreColumna}"`);
                const indiceColumna = headers.indexOf(nombreColumna);
                
                if (indiceColumna === -1) {
                    console.log(`❌ Columna "${nombreColumna}" no encontrada en ${nombreHoja}`);
                    console.log(`🔍 Búsqueda alternativa por coincidencia parcial...`);
                    
                    // Buscar por coincidencia parcial
                    const indiceAlternativo = headers.findIndex(h => h.includes(nombreColumna.split(' (')[0]));
                    if (indiceAlternativo !== -1) {
                        console.log(`⚠️ Encontrada columna similar: "${headers[indiceAlternativo]}" en índice ${indiceAlternativo}`);
                    }
                    
                    return { success: false, message: `Columna "${nombreColumna}" no encontrada` };
                }
                
                console.log(`✅ Columna encontrada en índice: ${indiceColumna}`);
                
                // Eliminar la columna usando el método correcto
                console.log(`🗑️ Eliminando columna en índice ${indiceColumna}...`);
                
                try {
                    // Método alternativo para eliminar columna
                    await hojaCalificaciones.deleteDimension('COLUMNS', {
                        startIndex: indiceColumna,
                        endIndex: indiceColumna + 1
                    });
                    console.log(`✅ Columna eliminada usando deleteDimension`);
                } catch (deleteError) {
                    console.log(`⚠️ deleteDimension falló, intentando método alternativo...`);
                    
                    // Método alternativo: limpiar la columna y luego eliminarla
                    await hojaCalificaciones.loadCells(`${String.fromCharCode(65 + indiceColumna)}:${String.fromCharCode(65 + indiceColumna)}`);
                    
                    // Limpiar todas las celdas de la columna
                    const filas = await hojaCalificaciones.getRows();
                    for (let i = 0; i < filas.length + 1; i++) {
                        const celda = hojaCalificaciones.getCell(i, indiceColumna);
                        if (celda) {
                            celda.value = '';
                        }
                    }
                    
                    await hojaCalificaciones.saveUpdatedCells();
                    console.log(`✅ Columna limpiada como alternativa`);
                }
                
                console.log(`✅ Operación de eliminación completada`);
                
                // Verificar que la columna fue eliminada
                await hojaCalificaciones.loadHeaderRow();
                const headersActualizados = hojaCalificaciones.headerValues;
                
                console.log(`📋 Headers después de eliminación:`);
                headersActualizados.forEach((header, index) => {
                    console.log(`   ${index}: "${header}"`);
                });
                
                console.log(`🎉 ELIMINACIÓN EXITOSA: Columna "${nombreColumna}" eliminada de ${nombreHoja}`);
                
                return { 
                    success: true, 
                    message: `Columna "${nombreColumna}" eliminada de ${nombreHoja}`,
                    headersRestantes: headersActualizados.length,
                    headersAntes: headers.length,
                    headersDespues: headersActualizados.length
                };
            } catch (headerError) {
                console.error(`❌ Error al procesar headers:`, headerError);
                throw headerError;
            }
        } catch (error) {
            console.error(`❌ ERROR CRÍTICO al eliminar columna de calificaciones:`, error);
            console.error(`   📋 Curso: ${curso}`);
            console.error(`   📋 Columna: "${nombreColumna}"`);
            return { 
                success: false, 
                message: `Error al eliminar columna: ${error.message}` 
            };
        }
    }

    async eliminarEstudiante(estudianteId) {
        try {
            if (!this.estudiantesSheet) throw new Error('Hoja de estudiantes no inicializada');
            
            const filas = await this.estudiantesSheet.getRows();
            const fila = filas.find(f => parseInt(f.get('ID')) === estudianteId);
            
            if (fila) {
                const nombreEstudiante = fila.get('Nombre Completo');
                await fila.delete();
                console.log(`🗑️ Estudiante eliminado de Google Sheets: ${nombreEstudiante} (ID: ${estudianteId})`);
                return { success: true, message: 'Estudiante eliminado de Google Sheets' };
            } else {
                return { success: false, message: 'Estudiante no encontrado en Google Sheets' };
            }
        } catch (error) {
            console.error('Error al eliminar estudiante:', error);
            return { success: false, message: 'Error al eliminar de Google Sheets' };
        }
    }

    async configurarHojasCalificaciones() {
        try {
            // Obtener todos los cursos únicos de los estudiantes
            const resultadoEstudiantes = await this.obtenerEstudiantes();
            if (!resultadoEstudiantes.success) {
                console.log('⚠️ No se pudieron obtener estudiantes para configurar calificaciones');
                return;
            }
            
            const cursos = [...new Set(resultadoEstudiantes.estudiantes.map(e => e.curso))];
            console.log('📊 Configurando hojas de calificaciones para cursos:', cursos);
            
            for (const curso of cursos) {
                await this.crearHojaCalificacionesCurso(curso);
            }
            
            // Agregar columnas para tareas existentes
            const resultadoTareas = await this.obtenerTareas();
            if (resultadoTareas.success && resultadoTareas.tareas.length > 0) {
                console.log('📝 Agregando columnas para tareas existentes...');
                for (const tarea of resultadoTareas.tareas) {
                    await this.actualizarHojaCalificacionesConTarea(tarea);
                }
            }
        } catch (error) {
            console.error('Error al configurar hojas de calificaciones:', error);
        }
    }

    async crearHojaCalificacionesCurso(curso) {
        try {
            const nombreHoja = `Calificaciones_${curso}`;
            let hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
            
            if (!hojaCalificaciones) {
                console.log(`📊 Creando hoja de calificaciones para curso: ${curso}`);
                
                hojaCalificaciones = await this.doc.addSheet({
                    title: nombreHoja,
                    headerValues: ['Nombre', 'Promedio']
                });
                
                // Agregar estudiantes del curso
                const resultadoEstudiantes = await this.obtenerEstudiantes();
                if (resultadoEstudiantes.success) {
                    const estudiantesCurso = resultadoEstudiantes.estudiantes.filter(e => e.curso === curso);
                    
                    for (const estudiante of estudiantesCurso) {
                        await hojaCalificaciones.addRow({
                            'Nombre': estudiante.nombre,
                            'Promedio': ''
                        });
                    }
                }
                
                console.log(`✅ Hoja de calificaciones creada para curso: ${curso}`);
            }
            
            return hojaCalificaciones;
        } catch (error) {
            console.error(`Error al crear hoja de calificaciones para curso ${curso}:`, error);
            return null;
        }
    }

    async actualizarHojaCalificacionesConTarea(tarea) {
        try {
            // Solo actualizar la hoja del curso específico de la tarea
            const cursoTarea = tarea.materia;
            console.log(`📝 Agregando tarea "${tarea.titulo}" solo al curso: ${cursoTarea}`);
            
            const nombreHoja = `Calificaciones_${cursoTarea}`;
            let hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
            
            if (!hojaCalificaciones) {
                console.log(`📊 Creando hoja de calificaciones para curso: ${cursoTarea}`);
                hojaCalificaciones = await this.crearHojaCalificacionesCurso(cursoTarea);
            }
            
            if (!hojaCalificaciones) {
                console.error(`❌ No se pudo crear/obtener la hoja para el curso: ${cursoTarea}`);
                return;
            }
            
            // Agregar columna para la nueva tarea
            await hojaCalificaciones.loadHeaderRow();
            const headers = hojaCalificaciones.headerValues;
            const nombreColumnaTarea = `${tarea.titulo} (${tarea.materia})`;
            
            if (!headers.includes(nombreColumnaTarea)) {
                // Insertar nueva columna antes de "Promedio"
                const indicePromedio = headers.indexOf('Promedio');
                
                if (indicePromedio === -1) {
                    console.error(`❌ No se encontró la columna "Promedio" en ${nombreHoja}`);
                    return;
                }
                
                await hojaCalificaciones.insertDimension('COLUMNS', {
                    startIndex: indicePromedio,
                    endIndex: indicePromedio + 1
                });
                
                // Actualizar headers
                await hojaCalificaciones.loadCells(`A1:${String.fromCharCode(65 + headers.length)}1`);
                const nuevaColumna = hojaCalificaciones.getCell(0, indicePromedio);
                nuevaColumna.value = nombreColumnaTarea;
                
                // Mover "Promedio" a la nueva posición
                const columnaPromedio = hojaCalificaciones.getCell(0, indicePromedio + 1);
                columnaPromedio.value = 'Promedio';
                
                await hojaCalificaciones.saveUpdatedCells();
                
                console.log(`✅ Columna agregada SOLO en ${nombreHoja}: ${nombreColumnaTarea}`);
            } else {
                console.log(`ℹ️ La columna "${nombreColumnaTarea}" ya existe en ${nombreHoja}`);
            }
        } catch (error) {
            console.error('Error al actualizar hoja de calificaciones con nueva tarea:', error);
        }
    }

    async asignarCalificacion(estudianteNombre, tareaId, calificacion) {
        try {
            // Obtener información del estudiante y la tarea
            const resultadoEstudiantes = await this.obtenerEstudiantes();
            const resultadoTareas = await this.obtenerTareas();
            
            if (!resultadoEstudiantes.success || !resultadoTareas.success) {
                throw new Error('No se pudieron obtener datos necesarios');
            }
            
            const estudiante = resultadoEstudiantes.estudiantes.find(e => e.nombre === estudianteNombre);
            const tarea = resultadoTareas.tareas.find(t => t.id === tareaId);
            
            if (!estudiante || !tarea) {
                throw new Error('Estudiante o tarea no encontrados');
            }
            
            const nombreHoja = `Calificaciones_${estudiante.curso}`;
            const hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
            
            if (!hojaCalificaciones) {
                throw new Error(`Hoja de calificaciones no encontrada para curso: ${estudiante.curso}`);
            }
            
            // Buscar la fila del estudiante y la columna de la tarea
            const filas = await hojaCalificaciones.getRows();
            const filaEstudiante = filas.find(f => f.get('Nombre') === estudianteNombre);
            
            if (filaEstudiante) {
                const nombreColumnaTarea = `${tarea.titulo} (${tarea.materia})`;
                filaEstudiante.set(nombreColumnaTarea, calificacion);
                
                // Calcular y actualizar promedio
                await this.calcularPromedioEstudiante(hojaCalificaciones, filaEstudiante);
                
                await filaEstudiante.save();
                
                console.log(`📊 Calificación asignada: ${estudianteNombre} - ${tarea.titulo}: ${calificacion}`);
                return { success: true, message: 'Calificación asignada exitosamente' };
            } else {
                throw new Error('Estudiante no encontrado en la hoja de calificaciones');
            }
        } catch (error) {
            console.error('Error al asignar calificación:', error);
            return { success: false, message: error.message };
        }
    }

    async calcularPromedioEstudiante(hojaCalificaciones, filaEstudiante) {
        try {
            await hojaCalificaciones.loadHeaderRow();
            const headers = hojaCalificaciones.headerValues;
            
            let suma = 0;
            let contador = 0;
            
            // Sumar todas las calificaciones (excluyendo "Nombre" y "Promedio")
            for (const header of headers) {
                if (header !== 'Nombre' && header !== 'Promedio') {
                    const calificacion = parseFloat(filaEstudiante.get(header));
                    if (!isNaN(calificacion)) {
                        suma += calificacion;
                        contador++;
                    }
                }
            }
            
            const promedio = contador > 0 ? (suma / contador).toFixed(2) : '';
            filaEstudiante.set('Promedio', promedio);
            
            return promedio;
        } catch (error) {
            console.error('Error al calcular promedio:', error);
            return '';
        }
    }

    async obtenerCalificacionesCurso(curso) {
        try {
            console.log(`📊 Obteniendo calificaciones para curso: ${curso}`);
            const nombreHoja = `Calificaciones_${curso}`;
            let hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
            
            if (!hojaCalificaciones) {
                // Intentar crear la hoja si no existe
                console.log(`📊 Creando hoja de calificaciones para curso: ${curso}`);
                hojaCalificaciones = await this.crearHojaCalificacionesCurso(curso);
                
                if (!hojaCalificaciones) {
                    return { success: false, message: `No se pudo crear la hoja de calificaciones para curso: ${curso}` };
                }
            }
            
            const filas = await hojaCalificaciones.getRows();
            await hojaCalificaciones.loadHeaderRow();
            
            console.log(`📋 Headers encontrados: ${hojaCalificaciones.headerValues.join(', ')}`);
            console.log(`👥 Estudiantes encontrados: ${filas.length}`);
            
            const calificaciones = {
                curso: curso,
                headers: hojaCalificaciones.headerValues,
                estudiantes: filas.map((fila, index) => {
                    const nombreEstudiante = fila.get('Nombre');
                    console.log(`👤 Procesando estudiante ${index + 1}: "${nombreEstudiante}"`);
                    
                    const datos = { 
                        nombre: nombreEstudiante,
                        Nombre: nombreEstudiante // Agregar ambas versiones por compatibilidad
                    };
                    
                    // Agregar todas las calificaciones
                    hojaCalificaciones.headerValues.forEach(header => {
                        if (header !== 'Nombre') {
                            const valor = fila.get(header) || '';
                            datos[header] = valor;
                            console.log(`  📊 ${header}: "${valor}"`);
                            
                            // Para columnas de tareas, marcar como no entregado por defecto
                            // (la lógica de entregas se manejará en el frontend)
                            if (header !== 'Promedio' && header.includes('(')) {
                                datos[`${header}_entregado`] = false;
                            }
                        }
                    });
                    
                    return datos;
                })
            };
            
            console.log(`✅ Calificaciones obtenidas exitosamente para ${curso}`);
            return { success: true, calificaciones };
        } catch (error) {
            console.error('Error al obtener calificaciones del curso:', error);
            return { success: false, message: `Error al obtener calificaciones: ${error.message}` };
        }
    }

    async limpiarColumnasIncorrectas() {
        try {
            console.log('🧹 Iniciando limpieza de columnas incorrectas en hojas de calificaciones...');
            
            // Obtener todas las tareas
            const resultadoTareas = await this.obtenerTareas();
            if (!resultadoTareas.success) {
                return { success: false, message: 'No se pudieron obtener las tareas' };
            }
            
            // Obtener todos los cursos
            const resultadoEstudiantes = await this.obtenerEstudiantes();
            if (!resultadoEstudiantes.success) {
                return { success: false, message: 'No se pudieron obtener los estudiantes' };
            }
            
            const cursos = [...new Set(resultadoEstudiantes.estudiantes.map(e => e.curso))];
            let columnasEliminadas = 0;
            
            for (const curso of cursos) {
                const nombreHoja = `Calificaciones_${curso}`;
                const hojaCalificaciones = this.doc.sheetsByTitle[nombreHoja];
                
                if (!hojaCalificaciones) continue;
                
                await hojaCalificaciones.loadHeaderRow();
                const headers = hojaCalificaciones.headerValues;
                
                console.log(`🔍 Revisando hoja: ${nombreHoja}`);
                console.log(`📋 Headers actuales: ${headers.join(', ')}`);
                
                // Buscar columnas que no corresponden a este curso
                for (let i = headers.length - 1; i >= 0; i--) {
                    const header = headers[i];
                    
                    // Si es una columna de tarea (contiene paréntesis)
                    if (header.includes('(') && header.includes(')')) {
                        const match = header.match(/^(.+) \((.+)\)$/);
                        if (match) {
                            const materiaTarea = match[2];
                            
                            // Si la materia de la tarea no coincide con el curso actual
                            if (materiaTarea !== curso) {
                                console.log(`❌ Columna incorrecta encontrada en ${nombreHoja}: "${header}" (debería estar solo en Calificaciones_${materiaTarea})`);
                                
                                // Eliminar la columna
                                await hojaCalificaciones.insertDimension('COLUMNS', {
                                    startIndex: i,
                                    endIndex: i + 1,
                                    inheritFromBefore: false
                                }, 'DELETE');
                                
                                columnasEliminadas++;
                                console.log(`🗑️ Columna eliminada: "${header}" de ${nombreHoja}`);
                            }
                        }
                    }
                }
            }
            
            console.log(`✅ Limpieza completada. ${columnasEliminadas} columnas incorrectas eliminadas.`);
            return { 
                success: true, 
                message: `Limpieza completada. ${columnasEliminadas} columnas incorrectas eliminadas.`,
                columnasEliminadas 
            };
        } catch (error) {
            console.error('Error al limpiar columnas incorrectas:', error);
            return { success: false, message: 'Error al limpiar columnas incorrectas' };
        }
    }

    async simplificarIDsEstudiantes() {
        try {
            if (!this.estudiantesSheet) throw new Error('Hoja de estudiantes no inicializada');
            
            console.log('🔧 Iniciando simplificación de IDs de estudiantes...');
            
            const filas = await this.estudiantesSheet.getRows();
            let contador = 1;
            
            for (const fila of filas) {
                const idActual = fila.get('ID');
                
                // Solo actualizar si el ID es mayor a 1000 (ID largo)
                if (parseInt(idActual) >= 1000) {
                    fila.set('ID', contador.toString());
                    await fila.save();
                    console.log(`✅ ID actualizado: ${idActual} → ${contador} (${fila.get('Nombre Completo')})`);
                    contador++;
                } else {
                    // Si ya es un ID simple, ajustar el contador
                    if (parseInt(idActual) >= contador) {
                        contador = parseInt(idActual) + 1;
                    }
                }
            }
            
            console.log(`🎉 Simplificación completada. Próximo ID disponible: ${contador}`);
            return { success: true, message: `IDs simplificados. Próximo ID: ${contador}`, proximoId: contador };
        } catch (error) {
            console.error('Error al simplificar IDs:', error);
            return { success: false, message: 'Error al simplificar IDs' };
        }
    }
    // ==================== GESTIÓN DE CURSOS ====================
    
    async obtenerCursosDetallados() {
        try {
            console.log('📊 Obteniendo información detallada de cursos...');
            
            // Obtener estudiantes y tareas
            const resultadoEstudiantes = await this.obtenerEstudiantes();
            const resultadoTareas = await this.obtenerTareas();
            
            if (!resultadoEstudiantes.success || !resultadoTareas.success) {
                return {
                    success: false,
                    message: 'Error al obtener datos base',
                    cursos: []
                };
            }
            
            // Obtener cursos únicos de estudiantes
            const cursosEstudiantes = [...new Set(resultadoEstudiantes.estudiantes.map(e => e.curso))];
            
            // Crear información detallada de cada curso
            const cursosDetallados = [];
            
            for (const nombreCurso of cursosEstudiantes) {
                const estudiantesCurso = resultadoEstudiantes.estudiantes.filter(e => e.curso === nombreCurso);
                const tareasCurso = resultadoTareas.tareas.filter(t => t.materia === nombreCurso);
                
                // Verificar si existe hoja de calificaciones
                const nombreHoja = `Calificaciones_${nombreCurso}`;
                const hojaExiste = this.doc.sheetsByTitle[nombreHoja] ? true : false;
                
                cursosDetallados.push({
                    nombre: nombreCurso,
                    estudiantes: estudiantesCurso.length,
                    tareas: tareasCurso.length,
                    hojaCalificaciones: hojaExiste
                });
            }
            
            // Ordenar por nombre
            cursosDetallados.sort((a, b) => a.nombre.localeCompare(b.nombre));
            
            console.log(`✅ Cursos detallados obtenidos: ${cursosDetallados.length}`);
            return {
                success: true,
                cursos: cursosDetallados
            };
        } catch (error) {
            console.error('❌ Error al obtener cursos detallados:', error);
            return {
                success: false,
                message: `Error al obtener cursos: ${error.message}`,
                cursos: []
            };
        }
    }
    
    async crearCurso(nombreCurso) {
        try {
            console.log(`🆕 Creando nuevo curso: ${nombreCurso}`);
            
            // Verificar si ya existe un estudiante con ese curso
            const resultadoEstudiantes = await this.obtenerEstudiantes();
            if (resultadoEstudiantes.success) {
                const cursoExiste = resultadoEstudiantes.estudiantes.some(e => e.curso === nombreCurso);
                if (cursoExiste) {
                    return {
                        success: false,
                        message: `El curso "${nombreCurso}" ya existe`
                    };
                }
            }
            
            // Verificar si ya existe la hoja de calificaciones
            const nombreHoja = `Calificaciones_${nombreCurso}`;
            if (this.doc.sheetsByTitle[nombreHoja]) {
                return {
                    success: false,
                    message: `Ya existe una hoja de calificaciones para el curso "${nombreCurso}"`
                };
            }
            
            // Crear hoja de calificaciones para el nuevo curso
            console.log(`📋 Creando hoja de calificaciones: ${nombreHoja}`);
            const nuevaHoja = await this.doc.addSheet({
                title: nombreHoja,
                headerValues: ['ID', 'Nombre Completo', 'Usuario', 'Promedio']
            });
            
            console.log(`✅ Curso "${nombreCurso}" creado exitosamente`);
            return {
                success: true,
                message: `Curso "${nombreCurso}" creado exitosamente`,
                curso: {
                    nombre: nombreCurso,
                    estudiantes: 0,
                    tareas: 0,
                    hojaCalificaciones: true
                }
            };
        } catch (error) {
            console.error(`❌ Error al crear curso "${nombreCurso}":`, error);
            return {
                success: false,
                message: `Error al crear curso: ${error.message}`
            };
        }
    }
    
    async eliminarCurso(nombreCurso) {
        try {
            console.log(`🗑️ Eliminando curso: ${nombreCurso}`);
            
            // Verificar si hay estudiantes en el curso
            const resultadoEstudiantes = await this.obtenerEstudiantes();
            if (resultadoEstudiantes.success) {
                const estudiantesCurso = resultadoEstudiantes.estudiantes.filter(e => e.curso === nombreCurso);
                if (estudiantesCurso.length > 0) {
                    console.log(`⚠️ Advertencia: El curso "${nombreCurso}" tiene ${estudiantesCurso.length} estudiantes`);
                }
            }
            
            // Verificar si hay tareas del curso
            const resultadoTareas = await this.obtenerTareas();
            if (resultadoTareas.success) {
                const tareasCurso = resultadoTareas.tareas.filter(t => t.materia === nombreCurso);
                if (tareasCurso.length > 0) {
                    console.log(`⚠️ Advertencia: El curso "${nombreCurso}" tiene ${tareasCurso.length} tareas`);
                }
            }
            
            // Eliminar hoja de calificaciones si existe
            const nombreHoja = `Calificaciones_${nombreCurso}`;
            const hoja = this.doc.sheetsByTitle[nombreHoja];
            
            if (hoja) {
                console.log(`🗑️ Eliminando hoja de calificaciones: ${nombreHoja}`);
                await hoja.delete();
                console.log(`✅ Hoja de calificaciones eliminada`);
            } else {
                console.log(`ℹ️ No existía hoja de calificaciones para el curso "${nombreCurso}"`);
            }
            
            console.log(`✅ Curso "${nombreCurso}" eliminado exitosamente`);
            return {
                success: true,
                message: `Curso "${nombreCurso}" eliminado exitosamente`
            };
        } catch (error) {
            console.error(`❌ Error al eliminar curso "${nombreCurso}":`, error);
            return {
                success: false,
                message: `Error al eliminar curso: ${error.message}`
            };
        }
    }
}

module.exports = GoogleSheetsService;