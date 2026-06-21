const fs = require('fs');
const files = ['chatbots.html', 'dashboard.html', 'entrenador-bot.html', 'inventario.html', 'mesas.html'];
const newMenu = `<a href="/admin/dashboard.html" class="menu-item">
          <span>📦</span> Productos
        </a>
        <a href="/admin/inventario.html" class="menu-item">
          <span>📈</span> Inventario / Asistente IA
        </a>
        <a href="/admin/insumos.html" class="menu-item">
          <span>🧻</span> Insumos Internos
        </a>
        <a href="/admin/caja.html" class="menu-item">
          <span>💰</span> Caja del Día
        </a>
        <a href="/admin/mesas.html" class="menu-item">
          <span>🪑</span> Mesas y Pedidos
        </a>
        <a href="/admin/chatbots.html" class="menu-item">
          <span>🤖</span> Chatbots IA
        </a>
        <a href="/admin/" class="menu-item">
          <span>📊</span> Panel de Ventas
        </a>
        <a href="/" class="menu-item" target="_blank">
          <span>🍽️</span> Ver Menú Público
        </a>`;

files.forEach(f => {
  const path = './admin/' + f;
  if (!fs.existsSync(path)) return;
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/<a href="\/admin\/dashboard\.html"[\s\S]*?Ver Menú Público\s*<\/a>/, newMenu);
  // Restore active class dynamically based on filename
  const activeClassRegex = new RegExp(`(<a href="/admin/${f}".*?class="menu-item)(")`);
  content = content.replace(activeClassRegex, '$1 active$2');
  fs.writeFileSync(path, content);
});
console.log('Sidebar updated');
