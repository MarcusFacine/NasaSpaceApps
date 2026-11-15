---
name: Horisite
description: lunar landing site navigator — relevo real do polo sul, luz do Sol e visada para a Terra
colors:
  sun: "#ffe600"
  pink: "#ff2f7d"
  orange: "#ff7a3c"
  earth: "#8ec5ff"
  psr-violet: "#8a7dff"
  ink: "#0a0a0a"
  paper: "#f2f1ec"
  white: "#ffffff"
  slate: "#5b6166"
  app-bg: "#050505"
  app-panel: "#0f0f10"
  app-raised: "#17171a"
  app-line: "#26262a"
  app-text: "#f4f4f1"
  app-muted: "#b4b4ad"
  app-dim: "#8f8f88"
typography:
  display:
    fontFamily: "Jost, Futura, 'Century Gothic', system-ui, sans-serif"
    fontSize: "clamp(56px, 8.6vw, 124px)"
    fontWeight: 800
    lineHeight: 0.94
    letterSpacing: "-0.05em"
  section-title:
    fontFamily: "Jost, Futura, system-ui, sans-serif"
    fontSize: "clamp(38px, 5.2vw, 68px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  app-title:
    fontFamily: "Jost, Futura, system-ui, sans-serif"
    fontSize: "clamp(30px, 3.1vw, 48px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Jost, Futura, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  data:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
rounded:
  sm: "12px"
  md: "18px"
  lg: "28px"
  band: "36px"
  pill: "999px"
spacing:
  gutter-mobile: "16px"
  gutter: "24px"
  card: "26px"
  section: "clamp(72px, 9vw, 128px)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "0 1.25em"
    height: "46px"
  button-primary-on-dark:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 1.25em"
    height: "46px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "currentColor"
    rounded: "{rounded.pill}"
    padding: "0 1.25em"
    height: "46px"
  app-panel:
    backgroundColor: "rgba(9, 9, 10, .9)"
    textColor: "{colors.app-text}"
    rounded: "24px"
    padding: "18px"
  site-chip:
    backgroundColor: "{colors.app-raised}"
    textColor: "{colors.app-text}"
    rounded: "{rounded.pill}"
    height: "40px"
  site-chip-primary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "40px"
  state-sun-visible:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  state-earth-visible:
    backgroundColor: "{colors.earth}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
---

# Design System: Horisite

## Overview

Duas superfícies, um mundo. A **landing** é clara (papel cinza-quente, preto, amarelo vivo, manchas de degradê amarelo e rosa, cartões arredondados), seguindo a referência que a equipe mandou. O **app** (`/app`) é a cena 3D escura de borda a borda, porque o assunto é o espaço e a luz rasante do polo sul; a marca e os controles são os mesmos da landing. O logotipo é a assinatura: "horisite" em minúsculas pesadas, letras sobrepostas com sombra própria, e o "o" como símbolo (anel em degradê rosa→amarelo com três feixes).

O 3D é o produto, não decoração: relevo LOLA real em três camadas, sombreamento de regolito, estrelas reais, a Terra com fase e orientação reais. A resposta ("visível ou bloqueado pelo relevo") aparece na própria cena, nos raios até o Sol e a Terra.

## Colors

### Primary
- **sun `#ffe600`**: a luz. Marca (marcação de palavras, ponto do botão, símbolo) e, nos dados, o Sol à vista. Nunca como texto sobre fundo claro.

### Secondary
- **earth `#8ec5ff`**: só a Terra (estado, raio, caminho, metade de baixo das células).
- **pink `#ff2f7d` / orange `#ff7a3c`**: degradê da marca; no app, rosa marca as etapas da missão na Lua (a janela).
- **psr-violet `#8a7dff`**: só a camada de sombra eterna.

### Neutral
- **ink `#0a0a0a`**, **paper `#f2f1ec`**, **white**, **slate `#5b6166`** na landing.
- App: fundo `#050505`, painéis `#0f0f10` e vidro escuro `rgba(9,9,10,.9)`, linhas `#26262a`, texto `#f4f4f1`, secundário `#b4b4ad`, terciário `#8f8f88` (≥ 5:1 sobre os painéis).

### Named Rules
- **Um significado por cor.** Amarelo = Sol, azul = Terra, violeta = sombra eterna, hachura cinza = atrás do relevo. Os locais não têm cor: são números de 1 a 5.
- **Ação não é cor de dado.** Botões são pretos (claro) ou brancos (escuro), com o ponto amarelo do logotipo.

## Typography

Jost (linha do Futura, a família da placa da Apollo) em tudo o que é texto; JetBrains Mono só em números e medidas (coordenadas, graus, horas, W/m²), sempre com números tabulares.

### Hierarchy
- Display da landing: 800, até 124 px, tracking −0,05em, entrelinha 0,94.
- Títulos de seção: 800, até 68 px.
- Título do app (nome do local): 700, até 48 px, sobre a cena com sombra de leitura.
- Corpo: 17 px, entrelinha 1,6, medida de até ~70 caracteres; rótulos do app no mínimo 12–13 px.

### Named Rules
- **Sem rótulo acima de título.** O título fala sozinho; não há "kicker" em maiúsculas espaçadas.

## Layout

- Landing: coluna de até 1240 px, seções com 72–128 px de respiro, mosaico de 12 colunas, faixas arredondadas de borda a borda (recurso, link, chamada final). No celular, tudo vira uma coluna com margem de 16 px.
- App: a cena ocupa a tela menos a barra de 64 px. Por cima: título e vistas (canto superior esquerdo), resposta Sol/Terra (superior direito, 330 px), ferramentas (lateral esquerda), console (rodapé: tempo + ações na primeira linha, data + locais na segunda). Abaixo de 1180 px, resposta e console descem para baixo da cena.
- Análise do app: horizonte (7/12) e 24 horas (5/12), depois altura e fonte dos dados.

## Elevation & Depth

Pouca sombra. Painéis do app usam vidro escuro com borda de 1 px e sombra longa e suave para descolar da cena; a landing usa sombra só nas capturas (moldura preta de 6 px) e nos cartões ao vivo do topo. A profundidade de verdade está no 3D.

## Shapes

Raios generosos e constantes: 12 (campos), 18 (figuras), 24–28 (painéis e cartões), 36 (faixas), pílula (botões, chips, abas, seletor de idioma). Ícones desenhados em traço de 1,8 px, nunca emoji.

## Components

### Buttons
Pílula de 46 px. Primário: preto com texto branco e ponto amarelo (no escuro, invertido). Fantasma: borda na cor do texto. Pressão: escala 0,97.

### Chips (locais)
Número em círculo + nome curto. Marcado: número preenchido. Em exploração: chip branco.

### Cards / Containers
Landing: cartões de 28 px de raio com fundo de cor inteira (amarelo, ardósia, preto com rosa). App: cartões `#0f0f10` com borda `#1d1d20`.

### Navigation
Barra simples com o logotipo, links e o seletor PT/EN em pílula com contorno.

### Células de 24 horas (assinatura de dados)
Cada hora é uma célula dividida: metade de cima amarela se o Sol está à vista, metade de baixo azul se a Terra está à vista, hachura quando atrás do relevo. Aparece no console (local em exploração) e na análise (locais comparados).

### Cena 3D (assinatura)
Relevo LOLA (40 m / 130 m / 1,56 km), regolito lunar-Lambert, sombras do Sol, estrelas HYG, raios até o Sol e a Terra com o ponto de bloqueio marcado, caminho de 24 h, linha do horizonte calculado na superfície, lente que mostra a Terra com fase real, camada violeta de sombra eterna. Abertura: a cena acende e o tempo corre até o Sol sair da borda no início da melhor janela.

## Do's and Don'ts

### Do:
- Mostrar a resposta na cena (raio, bloqueio, caminho) antes de qualquer número.
- Dizer o que é medido e o que é ilustrativo, perto de onde aparece.
- Abrir num momento com luz; quando o destino está no escuro, dizer por quê (e ligar a luz de leitura com aviso).

### Don't:
- Usar amarelo, azul ou violeta para outra coisa que não Sol, Terra e sombra eterna.
- Pôr rótulo em maiúsculas acima de títulos.
- Prometer instalação, loja de apps ou login: o produto abre no navegador e não tem contas.
