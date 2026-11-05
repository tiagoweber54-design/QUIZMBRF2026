---
name: teardown
description: Gera um visualizador 3D interativo (Three.js, um único HTML) com modelo desmontável (exploded view), lista de componentes, telemetria e cores extraídas de uma imagem de referência. Use quando o usuário pedir animação/modelo 3D a partir de uma imagem.
---

# Teardown

1. Analise a imagem de referência: identifique o objeto, suas partes principais e as cores dominantes.
2. Copie `teardown/index.html` do repositório como base (Three.js r128 via cdnjs, sem build).
3. Substitua o bloco de geometria (manto, reator, cabeça, olhos, barbatanas, funil, braços) por partes procedurais que representem o objeto da imagem. Cada parte é registrada com `addPart(id, nome, spec, group, direçãoDeExplosão, distância, posiçãoBase)`.
4. Ajuste título, specs e a paleta (`M.body`, `M.accent`, `M.dark`, `M.glow`) conforme a imagem.
5. Valide abrindo no navegador: slider de desmontagem, seleção por clique, auto-giro, wireframe e upload de imagem devem funcionar.
