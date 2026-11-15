# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Principal: a banca do NASA Space Apps. Abre o link durante a avaliação ou numa apresentação, quase sempre num notebook, às vezes projetado, com poucos minutos por projeto e sem tempo para tutorial. Precisa entender nos primeiros segundos o que o app responde e acreditar que ele usa dados reais.

Secundário: público curioso e estudantes que chegam pelo mesmo link e exploram no próprio ritmo.

## Product Purpose

O Horisite (antes Lunar Horizon 3D) explora o polo sul da Lua. Para um local e um horário UTC, mostra se o Sol e o centro da Terra estão acima do horizonte real do lugar, quanta luz chega a um painel e qual é o maior intervalo contínuo, nos próximos 30 dias, em que até três locais têm as duas coisas. Depois anima uma missão educativa Terra–Lua–Terra em torno dessa janela.

Sucesso: um jurado entende "luz e visada para a Terra, bloqueadas ou não pelo relevo real" sem ler instruções, e confia nos números.

## Positioning

Relevo real e céu real na mesma geometria: o modelo de elevação LRO/LOLA de 20 m do polo sul (NASA GSFC PGDA) mais efemérides do Astronomy Engine com paralaxe do observador, conferidas contra o JPL Horizons num caso de referência (diferenças abaixo de 0,003°). O horizonte de 360° sai desse relevo, então "visível" ou "bloqueado" é resposta do terreno, não de um esquema.

## Operating Context

- Feito para o NASA Space Apps (avaliação e apresentações do hackathon); público em https://187.77.229.205, na VPS Tétria/Elora (Coolify, build pack estático servindo `dist/`).
- Site estático sem etapa de build: `dist/` é o código-fonte. Three.js 0.186.1 e Astronomy Engine 2.1.19 vêm na pasta `vendor`; os cálculos não chamam API.
- Os dados são regenerados por `scripts/prepare-data.mjs` (precisa de rede); `scripts/check-model.mjs` e `scripts/check-mission.mjs` são as verificações de regressão.
- Repositório do Marcus Facine (MarcusFacine/NasaSpaceApps); mudanças entram por pull request.

## Capabilities and Constraints

- Cinco regiões de referência (borda de Shackleton, maciço Malapert, de Gerlache, borda de Nobile, Haworth); compara até três ao mesmo tempo.
- Vistas: relevo 3D (centro de 20 km a 40 m, recorte de 100 km a ~130 m e 400 km de contexto, escala vertical 1×), olho na superfície com lente, e globo lunar. Camada de sombra eterna (PSR) do PGDA.
- Sol e Terra: elevação, azimute, altura do horizonte LOLA e margem; irradiância incidente para painel rastreado ou horizontal; altura do observador de 2 a 20 m.
- Gráfico do horizonte em 360°; linha do tempo de 24 h de luz e visada; busca da melhor janela comum (30 dias, passo de 1 h).
- Simulação de missão em 13 etapas, órbitas de estacionamento circulares (μ do JPL DE440), transferências ilustrativas; reprodução 1×/2×/4×.
- Ferramentas WebMCP: `configure_lunar_comparison` e `read_lunar_visibility`.
- Precisa continuar honesto sobre os limites: relevo LOLA do PGDA com ~40 m no centro e ~130 m no recorte de 100 km, horizonte amostrado até ~195 km, transferências da missão ilustrativas, "Terra visível" é linha de visada para o centro dela, não enlace de rádio. Essas frases são verdade do produto e sobrevivem a qualquer redesenho.
- Precisa rodar em notebook comum de jurado (vídeo integrado) e no celular; renderizar só quando algo muda faz parte disso.
- Idiomas: português e inglês, com troca na página (decidido em 14/11/2026). Hoje o app é só em português.

## Brand Commitments

- Nome: **Horisite** (decidido pelo Ricardo em 14/11/2026, substituindo "Lunar Horizon"). Sem insígnia ou logo da NASA (uso restrito); a NASA aparece só como crédito dos dados (NASA SVS, LRO/LOLA, LROC).
- Créditos da equipe e do desafio do Space Apps ficam fora do site por enquanto.
- Referência visual vinculante: a landing page "pouso" que a equipe mandou em 14/11/2026 (claro, amarelo vivo com preto, manchas de degradê amarelo e rosa, cartões arredondados, palavras-chave marcadas em amarelo, rodapé com o nome gigante). A landing fica na raiz; o app, em /app, adota o mesmo mundo adaptado a ferramenta.
- Sem promessas de instalação, loja de apps ou login: o produto abre no navegador e não tem contas (decisão de 14/11/2026).

## Evidence on Hand

- Validação contra o JPL Horizons para Shackleton em 2026-10-02 12:00 UT (EVALUATION.md).
- Dados reais: recortes do DEM LOLA do PGDA e da sombra eterna em `dist/data/*.bin`, estrelas HYG em `dist/data/stars.json`, textura colorida LROC `dist/assets/moon-color.jpg` (2048 × 1024), texturas da Terra dos exemplos do Three.js.
- Tutorial ilustrado com capturas reais em `dist/tutorial.html` e `dist/tutorial/`.
- Não existem depoimentos, resultados de julgamento, prêmios ou números de uso; nada disso pode ser inventado.

## Product Principles

1. A resposta antes da explicação: visível ou bloqueado, claro ou escuro, deve dar para ler na própria cena antes de qualquer painel.
2. O dado real é o protagonista; dizer com clareza o que é medido e o que é ilustrativo.
3. Abrir num momento que signifique algo, nunca num estado vazio ou escuro sem dizer por quê.
4. Um significado por sinal: uma cor, ícone ou palavra nunca representa duas coisas.
5. Funciona para o jurado no projetor e para o estudante no celular.

## Accessibility & Inclusion

Contraste de texto WCAG 2.1 AA; controle por teclado da cena 3D (setas, Home) e de todos os controles; estados anunciados por `aria-live`; respeitar `prefers-reduced-motion`.
