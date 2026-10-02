# Avaliação e evolução para a versão 3D

A primeira versão tinha uma base de interface clara e boa separação entre locais e indicadores. Sua principal limitação era o modelo de dados: os valores pareciam métricas de missão, embora fossem funções senoidais sem vínculo com efemérides reais.

| Aspecto | Versão inicial | Versão Three.js |
| --- | --- | --- |
| Sol e Terra | Senóides e offsets fixos por local | Vetores astronômicos, orientação lunar e paralaxe |
| Relevo | Perfil sintético | LRO/LOLA com curvatura lunar |
| Visualização | SVG polar; “Perfil” inclinava o mesmo SVG | Malha 3D, câmera na superfície e globo texturizado |
| Energia | Estado binário do Sol | Fração de disco e irradiância incidente em W/m² |
| Comunicação | “Link direto disponível” baseado em altitude | Linha de visada para o centro da Terra |
| Melhor janela | Maior pontuação em um instante | Maior intervalo contínuo comum aos locais selecionados |
| Cronograma | Reiniciava à meia-noite | Próximas 24 horas desde a hora selecionada |
| Seleção de locais | Quarto local substituía silenciosamente o primeiro | Limite explícito de três, com mensagem |
| Câmera / seleção | Selecionar também removia um local | Checkbox compara; nome abre o terreno |

## Referência independente

Comparação ao [JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html), observador `coord@301`, coordenadas −129,2° de longitude e −89,66° de latitude, altitude 0,754492 km (incluindo observador de 2 m), data 2026-10-02 12:00 UT, quantidade 4 e sem refração:

| Corpo / coordenada | Horizons | Aplicativo | Diferença absoluta |
| --- | ---: | ---: | ---: |
| Sol / azimute | 53,767315° | 53,769711° | 0,002396° |
| Sol / elevação | 1,219850° | 1,219349° | 0,000501° |
| Terra / azimute | 129,729085° | 129,726710° | 0,002376° |
| Terra / elevação | 5,496299° | 5,495202° | 0,001097° |

Esse resultado verifica um caso específico, não certifica precisão global nem precisão das obstruções. O teste de regressão usa tolerância de 0,01°. `node scripts/validate-horizons.mjs` refaz a consulta externa, sequencialmente; `node scripts/check-model.mjs` usa os valores fixados acima sem rede.

Também foram verificados: ortonormalidade do referencial lunar, subponto terrestre comparado às librações em quatro épocas de 2000 a 2050, curvatura do terreno, monotonicidade do horizonte com altura do observador, limites de irradiância e distância lunar, coerência de visibilidade e cálculo de intervalos contínuos.

No navegador foram exercitadas as três câmeras, a mudança de local, orientação de painel, passagem do tempo e busca de janelas. O caso Shackleton + Malapert a partir de 2026-10-02 12:00 UTC encontrou um intervalo comum amostrado de 150 h, começando em 2026-10-22 18:00 UTC. A interface móvel foi inspecionada em viewport de 390 × 844: a largura de rolagem da página coincidiu com a largura disponível; a lista de locais possui sua própria rolagem horizontal. Nenhum erro de execução foi registrado. Os controles WebMCP foram validados com configuração válida, leitura de resultados e rejeição de parâmetros inválidos sem alteração do estado.

## Limites que permanecem

A resolução norte–sul do DEM original é ~474 m. A reamostragem da malha não cria detalhe adicional. O horizonte ignora relevo além de 50 km e obstáculos menores que o pixel. As posições usam a orientação lunar IAU aproximada; a textura do globo e a rotação da textura terrestre são recursos visuais. Não há otimização de trajetória, enlace, baterias, temperatura ou risco de pouso nesta versão.
