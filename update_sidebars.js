const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, 'admin');
const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.html') && f !== 'pos.html' && f !== 'pedidos.html');

const insertLinks = `
        <a href="/admin/pos.html" class="menu-item">
          <span>📝</span> Tomar Pedido
        </a>
        <a href="/admin/pedidos.html" class="menu-item">
          <span>🍳</span> Cocina / Pedidos
        </a>`;

files.forEach(file => {
  const filePath = path.join(adminDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find where to insert
  const regex = /(<a href="\/admin\/dashboard\.html"[^>]*>[\s\S]*?<\/a>)/i;
  
  if (regex.test(content) && !content.includes('pos.html')) {
    content = content.replace(regex, `$1${insertLinks}`);
    fs.writeFileSync(filePath, content);
    console.log('Updated ' + file);
  }
});
