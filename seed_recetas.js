const db = require('./backend/config/database.js');

async function seed() {
  console.log('Sembrando insumos y recetas...');
  
  const insumos = [
    // Proteínas (Costo basado en Excel: Res $31/g, Cerdo $16/g, Costilla $24/g, Ubre $24/g, Pollo $14/g)
    { nombre: 'Carne de Res', categoria: 'Proteína', unidad: 'gramos', costo_promedio: 31 },
    { nombre: 'Carne de Cerdo', categoria: 'Proteína', unidad: 'gramos', costo_promedio: 16 },
    { nombre: 'Costilla BBQ', categoria: 'Proteína', unidad: 'gramos', costo_promedio: 24 },
    { nombre: 'Ubre', categoria: 'Proteína', unidad: 'gramos', costo_promedio: 24 },
    { nombre: 'Pollo', categoria: 'Proteína', unidad: 'gramos', costo_promedio: 14 },
    { nombre: 'Tocino / Chicharrón', categoria: 'Proteína', unidad: 'gramos', costo_promedio: 18 },
    
    // Base y Empaque
    { nombre: 'Plátano', categoria: 'Verduras', unidad: 'unidades', costo_promedio: 1200 },
    { nombre: 'Empaque Domo', categoria: 'Empaques', unidad: 'unidades', costo_promedio: 600 },
    
    // Ingredientes del Chimichurri y Adobos
    { nombre: 'Perejil', categoria: 'Verduras', unidad: 'gramos', costo_promedio: 5 },
    { nombre: 'Pimentón', categoria: 'Verduras', unidad: 'gramos', costo_promedio: 6 },
    { nombre: 'Ajos', categoria: 'Verduras', unidad: 'gramos', costo_promedio: 10 },
    { nombre: 'Cebolla Cabezona', categoria: 'Verduras', unidad: 'gramos', costo_promedio: 4 },
    { nombre: 'Aceite de Girasol', categoria: 'Abarrotes', unidad: 'ml', costo_promedio: 8 },
    { nombre: 'Salsa Soya', categoria: 'Salsas', unidad: 'ml', costo_promedio: 12 },
    { nombre: 'Mostaza', categoria: 'Salsas', unidad: 'gramos', costo_promedio: 10 },
    { nombre: 'Comino', categoria: 'Condimentos', unidad: 'gramos', costo_promedio: 20 },
    { nombre: 'Pimienta', categoria: 'Condimentos', unidad: 'gramos', costo_promedio: 30 },
    { nombre: 'Sal', categoria: 'Condimentos', unidad: 'gramos', costo_promedio: 2 },
    { nombre: 'Orégano', categoria: 'Condimentos', unidad: 'gramos', costo_promedio: 25 },
    { nombre: 'Sazona Rey (Sazona Todo)', categoria: 'Condimentos', unidad: 'gramos', costo_promedio: 15 },
    { nombre: 'Cúrcuma', categoria: 'Condimentos', unidad: 'gramos', costo_promedio: 20 },
    
    // Porción genérica de chimichurri para costeo rápido
    { nombre: 'Porción de Chimichurri', categoria: 'Preparaciones', unidad: 'porciones', costo_promedio: 1300 }
  ];

  const dbAsync = {
    run: (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { if(err) reject(err); else resolve(this); })),
    get: (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => { if(err) reject(err); else resolve(row); })),
    all: (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => { if(err) reject(err); else resolve(rows); }))
  };

  const insumosMap = {};
  for (let ins of insumos) {
    let existing = await dbAsync.get('SELECT id FROM insumos WHERE nombre = ?', [ins.nombre]);
    if (!existing) {
      const res = await dbAsync.run(
        'INSERT INTO insumos (nombre, categoria, unidad, costo_promedio, cantidad) VALUES (?, ?, ?, ?, 1000)',
        [ins.nombre, ins.categoria, ins.unidad, ins.costo_promedio]
      );
      insumosMap[ins.nombre] = res.lastID;
    } else {
      await dbAsync.run('UPDATE insumos SET costo_promedio = ? WHERE id = ?', [ins.costo_promedio, existing.id]);
      insumosMap[ins.nombre] = existing.id;
    }
  }

  const recetas = [
    { prod_id: 2, insumos: [ {n: 'Carne de Res', c: 225}, {n: 'Plátano', c: 1}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 100} ] },
    { prod_id: 1, insumos: [ {n: 'Carne de Res', c: 125}, {n: 'Plátano', c: 0.5}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 50} ] },
    
    { prod_id: 4, insumos: [ {n: 'Carne de Cerdo', c: 225}, {n: 'Plátano', c: 1}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 100} ] },
    { prod_id: 3, insumos: [ {n: 'Carne de Cerdo', c: 125}, {n: 'Plátano', c: 0.5}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 50} ] },
    
    { prod_id: 10, insumos: [ {n: 'Costilla BBQ', c: 225}, {n: 'Plátano', c: 1}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 100} ] },
    { prod_id: 9, insumos: [ {n: 'Costilla BBQ', c: 125}, {n: 'Plátano', c: 0.5}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 50} ] },

    { prod_id: 6, insumos: [ {n: 'Ubre', c: 225}, {n: 'Plátano', c: 1}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 100} ] },
    { prod_id: 5, insumos: [ {n: 'Ubre', c: 125}, {n: 'Plátano', c: 0.5}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 50} ] },

    { prod_id: 8, insumos: [ {n: 'Pollo', c: 225}, {n: 'Plátano', c: 1}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 100} ] },
    { prod_id: 7, insumos: [ {n: 'Pollo', c: 125}, {n: 'Plátano', c: 0.5}, {n: 'Empaque Domo', c: 1}, {n: 'Porción de Chimichurri', c: 1}, {n: 'Tocino / Chicharrón', c: 50} ] },
  ];

  await dbAsync.run('DELETE FROM recetas');

  for (let rec of recetas) {
    for (let ins of rec.insumos) {
      let insumo_id = insumosMap[ins.n];
      if (insumo_id) {
        await dbAsync.run(
          'INSERT INTO recetas (producto_id, insumo_id, cantidad_usada) VALUES (?, ?, ?)',
          [rec.prod_id, insumo_id, ins.c]
        );
      }
    }
  }

  console.log('¡Siembra completada con éxito!');
  process.exit(0);
}

seed().catch(console.error);
