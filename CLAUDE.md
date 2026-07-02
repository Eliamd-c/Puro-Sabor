# CLAUDE.md - Reglas del Proyecto Puro Sabor

## 🎯 Principio Fundamental

**TODO DEBE ESTAR PENSADO PARA:**
1. ✅ Subir a GitHub (`git push origin main`)
2. ✅ Desplegar en Hostinger (Node.js)
3. ✅ Listo para producción (sin cambios pendientes)

**REGLA DE ORO:** Si no está en GitHub y no se puede desplegar, la tarea NO está completa.

---

## 📋 Checklist Antes de Terminar

Antes de cualquier "Adelante", verifica:

- [ ] ¿El código compila sin errores?
- [ ] ¿Todos los cambios están staged en Git?
- [ ] ¿Se creó el commit con descripción clara?
- [ ] ¿Se hizo `git push origin main`?
- [ ] ¿GitHub muestra los nuevos commits?
- [ ] ¿La rama local está sincronizada con origin/main?

**Si alguno falla → NO está completo**

---

## 🚀 Workflow de Implementación

```
1. Implementar feature/FASE
   └─ Código escrito y probado

2. Documentar
   └─ Crear FASE_X_*.md con detalles

3. Commit
   └─ git commit con descripción completa
   └─ Incluir: "Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

4. PUSH A GITHUB
   └─ git push -u origin main
   └─ ✅ Verificar en GitHub

5. Reportar completitud
   └─ Respuesta usuario: "FASE X COMPLETADA ✅"
   └─ Estado: "Ready para Hostinger"
```

---

## 🏗️ Estructura del Proyecto

```
Puro-Sabor/
├─ backend/
│  ├─ config/          (DB, Redis, env, cache)
│  ├─ routes/          (API endpoints)
│  ├─ middleware/      (Auth, compression, validation)
│  ├─ services/        (Business logic)
│  ├─ utils/           (Helpers, monitoring, caching)
│  ├─ errors/          (Error classes)
│  └─ server.js        (Entry point)
├─ database/           (SQL schema, indexes)
├─ public/             (Frontend assets)
├─ package.json        (Dependencies)
└─ .env                (Environment - LOCAL ONLY)
```

**Importante:** `.env` es LOCAL ONLY - nunca commitear secretos a Git

---

## 🔧 Stack Requerido

**Backend:**
- Node.js (18+)
- Express.js
- PostgreSQL (Supabase)
- Redis (Upstash)
- Socket.io

**Frontend:**
- HTML5
- CSS3
- JavaScript (vanilla)
- WebSocket integration

**Deployment:**
- Hostinger (Node.js)
- PostgreSQL 14+
- Redis compatible

**No usar:**
- TypeScript (por ahora)
- React/Vue/Angular
- Frameworks pesados
- Librerías no-documentadas

---

## 🔐 Security Requirements (FASE 1)

- ✅ SSL/TLS validation
- ✅ JWT + 2FA authentication
- ✅ Rate limiting
- ✅ Input validation
- ✅ Path traversal protection
- ✅ XSS prevention (xss-clean)
- ✅ SQL injection prevention

**Regla:** Cualquier endpoint sin autenticación debe estar justificado en comentarios

---

## 🔄 Reliability Requirements (FASE 2)

- ✅ Connection pooling (2-10 connections)
- ✅ Error handling (hierarchical)
- ✅ Health monitoring (every 30s)
- ✅ Cluster synchronization (Redis Pub/Sub)
- ✅ Graceful shutdown (15s timeout)

**Regla:** Todo debe tolerar fallos transitorios

---

## ⚡ Performance Requirements (FASE 3)

### FASE 3.1: Indexing
- ✅ 25+ indexes on query paths
- ✅ 100x query speedup target
- ✅ Use EXPLAIN ANALYZE to verify

### FASE 3.2: Compression
- ✅ Gzip (level 6) on all endpoints
- ✅ Brotli (level 11) for modern browsers
- ✅ 70% compression ratio target

### FASE 3.3: Caching
- ✅ L1: Redis (5-10ms access)
- ✅ L2: Memory (1-2ms access)
- ✅ L3: Database (50-500ms)
- ✅ 90%+ hit rate target

### FASE 3.4: Pagination
- ✅ Offset pagination (default)
- ✅ Cursor pagination (optional)
- ✅ Limit: 1-500 items/page
- ✅ 100x data reduction target

### FASE 3.5: Monitoring
- ✅ Query performance tracking
- ✅ Slow query detection (>100ms, >1000ms)
- ✅ N+1 pattern detection
- ✅ Health score (0-100)

**Regla:** Performance debe mejorar o mantenerse, nunca empeorar

---

## 📊 Testing Requirements

**Antes de Adelante:**
- [ ] Browser testing (Chrome, Firefox, Safari)
- [ ] Mobile responsive (375px+)
- [ ] Slow network simulation (throttle)
- [ ] Concurrent users (load test)
- [ ] API endpoint verification

**No se requiere:** Unit tests formales (pero recomendado)

---

## 🎯 Git Workflow

### Commits
```
Format: feat/fix: [FASE X.Y] - Description

Good:    feat: FASE 3.2 - Add response compression
Bad:     update, fix stuff, WIP

Include:
- Clear description of what changed
- Why it was changed
- Files affected
- Co-authored footer
```

### Branches
```
Main branch: origin/main (production-ready)
No feature branches needed (too small team)
Every push must be ready to deploy
```

### Before Push
```
1. git status              → Clean working tree?
2. git diff origin/main    → Intentional changes?
3. git log --oneline       → Clear commits?
4. npm start (locally)     → Runs without errors?
5. git push -u origin main → Success?
```

---

## 🏗️ Deployment to Hostinger

### Requirements
- Node.js app on Hostinger
- .env configured on server (never in Git)
- DATABASE_URL → PostgreSQL
- REDIS_URL → Redis/Upstash
- PORT → 3001 or configured

### Verification
```bash
# On Hostinger server:
npm install
npm start

# Check:
- curl http://localhost:3001 → 200 OK?
- curl http://localhost:3001/health → {status: ok}?
- curl http://localhost:3001/diagnostic → {status: ok}?
```

---

## 📝 Documentation Standards

For each FASE:
- [ ] Create FASE_X_Y_*.md
- [ ] Include: Problem → Solution → Implementation
- [ ] Include: Performance metrics before/after
- [ ] Include: Files modified/created
- [ ] Include: Success criteria
- [ ] Include: Example API responses

---

## ⚠️ Common Mistakes to Avoid

❌ **DON'T:**
- Commit `.env` files
- Leave console.log() in production code
- Use `any` types without justification
- Merge without pushing to GitHub
- Change package.json without testing
- Deploy without testing locally first

✅ **DO:**
- Push after every FASE
- Test on mobile
- Monitor /health/performance
- Use meaningful commit messages
- Document breaking changes

---

## 🚨 Critical Issues

These MUST be fixed immediately:

1. **Security breach** → Fix + Document
2. **Data loss risk** → Fix + Review
3. **No authentication on endpoint** → Fix + Add
4. **Crashes on production data** → Fix + Test
5. **Out of sync with GitHub** → Push + Verify

---

## 📞 Contact & Status

**Project Owner:** elamd.se@gmail.com  
**Repository:** https://github.com/Eliamd-c/Puro-Sabor  
**Deployment:** Hostinger Node.js  
**Status:** Production-Ready (Post FASE 3.5)

**Last Updated:** 2026-07-02  
**Phases Complete:** 1, 2, 3.1, 3.2, 3.3, 3.4, 3.5 ✅

---

## 🎓 Learning Resources

### For Future Developers
- FASE_1_SECURITY_HARDENING_COMPLETE.md
- FASE_2_5_GRACEFUL_SHUTDOWN_COMPLETE.md
- FASE_3_1_DATABASE_INDEXING_COMPLETE.md
- FASE_3_3_MULTI_LEVEL_CACHING_COMPLETE.md
- FASE_3_5_QUERY_MONITORING_COMPLETE.md

All documentation is in the root directory.

---

**Remember:** 
> "It's not done until it's in GitHub and deployable to Hostinger"
> — Project Rule #1
