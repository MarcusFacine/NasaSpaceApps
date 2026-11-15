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
# Simulação Terra–Lua–Terra (versão 3)

A janela calculada agora é retida explicitamente com início, fim, seleção e altura. A missão captura esses dados e o local em foco; sem uma janela calculada aplicável a esse local, usa a data selecionada como início de uma janela manual identificada. Mudanças na data, na comparação ou na altura invalidam a janela calculada anterior. A seleção é lembrada somente no navegador do usuário.

O cronograma antecipa o lançamento pela duração da ida e exige que a permanência caiba na janela. A cena acompanha a Lua pela efeméride, mostra curvas de ida e volta e muda para o DEM LOLA no pouso, na permanência e na decolagem. Luz local usa direção e fração visível do Sol. O veículo genérico tem ~14 m na cena local e é ampliado na visão espacial.

Validação: continuidade de posição e relógio nas sete etapas; datas de lançamento, pouso, saída e retorno; vetores finitos; rejeição de durações inválidas; animação completa até a Terra; controle de duração e câmera; largura móvel de 390 px sem transbordamento horizontal; sem erros de execução observados no navegador. Caso exercitado: janela comum Shackleton/Malapert de 22/10/2026 18:00 a 29/10/2026 00:00 UTC, ida de 72 h, permanência de 24 h e retorno de 72 h. Chegada à Terra em 26/10/2026 18:00 UTC.

Limite da versão inicial da missão: a animação era inteiramente cinemática, sem órbitas de estacionamento. A revisão abaixo substitui apenas esses trechos por órbitas circulares analíticas; as transferências continuam ilustrativas.

## Revisão: órbitas de estacionamento

Agora há 13 etapas, incluindo estacionamento terrestre a 300 km (1,5 volta), estacionamento lunar a 100 km antes do pouso e após a decolagem (1 volta em cada trecho), e queimas visuais TLI/LOI/TEI. Períodos e velocidades seguem a solução circular de dois corpos com μ JPL DE440: ~90,5 min / 7,73 km/s na Terra e ~117,8 min / 1,63 km/s na Lua. Os motores ficam desligados nas órbitas. O plano lunar é polar e fixo no referencial inercial, com o centro acompanhando a efeméride. Não representa um estilingue ou economia demonstrada de combustível.

Os tempos das novas etapas são descontados dos totais da ida/volta; a janela, o pouso, a permanência e o retorno do caso de referência não mudam. A câmera automática enquadra as órbitas e o DEM nos últimos 400 m do trecho local. Há anéis orbitais, contador de voltas, velocidade circular e resumo dos períodos.

Validação automatizada: cronograma das 13 fases, continuidade de posição, órbitas fechadas, velocidade tangencial, velocidade numérica consistente com Kepler, motores desligados e raio constante. Ligações visuais verificadas para cinco locais, elevação de 4,5 km e durações de 24, 72 e 240 h. A seleção de controles Bézier rejeita cruzamentos das esferas planetárias em 1001 amostras, sem constituir validação de navegação.

Limites restantes: transferências Bézier corrigidas pela efeméride lunar; subida/descida, queimas e reentrada interpoladas. Há continuidade C0, não garantia de continuidade de velocidade. Não há solução de Lambert, integração de três corpos, delta-v, combustível, atmosfera ou otimização do plano de lançamento. As condições de luz/visada não certificam voo, enlace ou obstáculos na descida. O retorno terrestre e as texturas são visuais. O DEM não resolve o contato do veículo com o solo.

### Revisão de continuidade e cutscenes (08/10/2026)

Restauradas as cenas de subida/descida próximas do terreno (cerca de 14–15 s em 1×, dentro de etapas de 20 s). A animação total passa a 140 s, sem alterar as datas UTC da missão. Relógio de apresentação com aceleração/desaceleração nas bordas das etapas; junções Bézier tangentes nas transferências; atitudes contínuas e prógradas durante o estacionamento lunar. A rotação para a vertical ocorre apenas com a descida já iniciada. A câmera interpola alvo, direção e zoom durante 1,8 s, preserva a pose ao trocar de referencial espacial/local e acompanha a aproximação/afastamento do terreno. Esses ajustes são de apresentação, não uma nova solução de dinâmica orbital.

Verificações: continuidade de posição e atitude em todas as etapas, duração da cena local, altitude monotônica na subida/descida, orientação prógrada nas órbitas, conversão bidirecional dos referenciais da câmera, interpolação incremental sem saltos, períodos/velocidades circulares e ausência de interseção com os globos nas transferências de 24/72/240 h nos cinco locais.

# Horisite: relevo PGDA de 20 m e redesenho (novembro de 2026)

O DEM SVS de 474 m (`ldem_64`) foi trocado pelos DEMs LOLA do polo sul do NASA GSFC PGDA (produto 90, Barker et al. 2023), lidos como Cloud-Optimized GeoTIFF só na janela de cada local:

| Camada | Fonte | Recorte | Espaçamento |
| --- | --- | --- | --- |
| Centro | `LDEM_80S_20MPP_ADJ`, versão de 40 m | 20 × 20 km | ~39 m |
| Detalhe | `LDEM_80S_20MPP_ADJ`, versão de 80 m | 100 × 100 km | ~130 m |
| Contexto | `LDEM_60S_240MPP_ADJ`, versão de 480 m | 400 × 400 km | ~1,56 km |

Conferência da projeção (estereográfica polar sul, esfera de 1737,4 km): nos mesmos 257 × 257 pontos dos recortes antigos, a diferença média para o DEM SVS foi de 7,6 a 8,6 m e a correlação, de 0,99994 a 0,99999. A versão espelhada dá ~1,2 km de diferença, o que confirma a orientação. O horizonte passou a usar o relevo até ~195 km (antes, 50 km).

Os resultados mudam onde o relevo fino importa. Em Shackleton, 2026-10-02 12:00 UTC, o horizonte na direção do Sol foi de +4,63° para **+8,52°**: o ponto fica numa encosta, e a 0,5 km nessa direção o terreno está ~80 m mais alto, algo que a malha de 474 m suavizava. O Sol passa de −3,41° para −7,30° em relação ao relevo; a Terra continua à vista (+5,79°). Malapert não muda de forma relevante (Sol +2,00°, Terra +12,91°, ≈1.357 W/m²). A maior janela comum Shackleton + Malapert a partir dessa data passou de 150 h para **136 h**, de 2026-10-23 00:00 a 2026-10-28 16:00 UTC; Shackleton + Malapert + Haworth continua sem janela. A comparação com o JPL Horizons (posições do Sol e da Terra) não depende do relevo e continua válida.

Visual (sem efeito nos cálculos): sombreamento de regolito lunar-Lambert, sombras do Sol até ~125 km em computadores com GPU capaz, micro-relevo sintético abaixo da malha, céu do catálogo HYG v4.1, Terra orientada pelo tempo sideral de Greenwich (precessão ignorada, ~0,4°) com fase real, nuvens e luzes noturnas, e a camada de sombra eterna do mapa `LPSR_80S_20MPP_ADJ` (fração por célula da versão de 80 m).

Verificações: `check-model` e `check-mission` passam com os recortes novos; o app foi exercitado no navegador em 1440 × 900 e 390 × 844 sem erros de execução.

## Revisão da missão: perfil Apollo (15/11/2026)

Pedido da equipe: a decolagem e a volta não correspondiam a nenhuma missão real, e a nave e o solo pareciam artificiais. A missão passou a seguir o perfil das Apollo que pousaram na Lua, com os números da Apollo 11 (NASA, Apollo 11 Mission Report, MSC-00171):

- Lançamento do Kennedy (LC-39A) a 72° de azimute, em curva de gravidade, com os estágios do Saturn V soltos em 2 min 41 s e 9 min 9 s; órbita de espera de 185 km (88,2 min), 1,5 volta; injeção translunar.
- Nave-mãe e módulo lunar acoplados até a Lua; órbita lunar de 110 km (118,8 min), 13 voltas antes do pouso e 5 depois da decolagem (menos quando a viagem escolhida é mais curta). Ida padrão 103 h, solo 22 h, volta 71 h; os trechos de cruzeiro ficam em ~74 h e ~60 h, como na Apollo 11.
- Descida freando com o motor à frente e pouso vertical; na decolagem só o estágio de subida sobe, e o de descida fica no solo.
- Reentrada só da cápsula, a 121,9 km e −6,5°, com a bola de plasma; paraquedas de arrasto a 7,3 km e os três principais a 3,2 km; amerissagem no Pacífico (faixa de 150° L a 120° O, na latitude do resgate da Apollo 11), num ponto com o Sol a pelo menos 15°. Se todo o Pacífico estiver no escuro, a volta é ajustada pelo menor tempo possível (até ±10 h) e o painel avisa.
- Antes, a volta terminava com o veículo descendo na vertical sobre o Cabo Canaveral e o arco de volta mergulhava reto na Terra.

Visual: naves com proporções publicadas (Saturn V, CSM, LM com folha dourada, cápsula com escudo e paraquedas de 25 m); local de pouso de 800 × 800 m em malha de 2 m sobre o LOLA, com crateras pequenas, ondulação e pedras ilustrativas (o LOLA não resolve nada menor que ~40 m); poeira soprada pelo motor; sombras longas do Sol rasante; cena do oceano com o Sol real no ponto e na hora da amerissagem; a Terra com nuvens (a máscara das nuvens é o canal alfa da imagem; antes era lido o canal verde, e a camada saía branca com furos). Ao abrir a simulação com a hora escolhida sem Sol e Terra no destino, a missão usa a próxima janela com os dois.

Continua ilustrativo: as transferências (curvas, não Lambert nem três corpos), as queimas, a subida, a descida e a reentrada, sem delta-v nem combustível. `check-mission` verifica o perfil (configuração de cada etapa, períodos, voltas, cruzeiros, altitude de reentrada, plasma, ponto no Pacífico) além das verificações anteriores.

## Gráfico do relevo junto da resposta (15/11/2026)

"O que o relevo esconde" saiu da análise, no pé da página, e foi para o painel do Sol e da Terra, ao lado da cena: com o tempo correndo, dá para acompanhar o Sol e a Terra passando atrás do relevo. O console termina antes do painel, as ferramentas da cena ficam numa fileira logo acima do console, e no tablet e no celular o painel (que antes ficava escondido atrás da cena) aparece entre a cena e o console.

## Trilhas no console, locais na cena e missão ao lado da nave (15/11/2026, segunda rodada)

Pedidos da equipe: as 24 horas também precisavam subir; os locais selecionados deviam aparecer na cena para comparar distâncias; e a missão ainda parecia um esquema.

- **Trilhas na barra do tempo.** O cartão "Próximas 24 horas" saiu do pé da página. A barra do tempo passou a ter uma trilha por local comparado, para o dia UTC escolhido, com o cursor cruzando todas, o número do local à esquerda (clicável) e, à direita, o maior trecho do dia com Sol e Terra juntos.
- **Locais na cena.** Os cinco pontos ficam a 37–186 km uns dos outros (grande círculo), dentro do relevo de contexto de 400 km. Cada local comparado tem um pino no relevo (projeção de plano tangente, a mesma do terreno), uma linha fina no chão até o local em exploração e um rótulo com nome e distância; fora do quadro, o rótulo encosta na borda livre da cena e uma seta aponta a direção. Clicar no rótulo explora o local.
- **Missão.** Etapa nova de decolagem na plataforma 39A (ignição e os primeiros 3,4 km, 50 s), com o Saturn V em tamanho real, torre umbilical de 116 m, chama, fumaça e o Sol real do Kennedy naquela hora. A câmera automática voa ao lado da nave em escala real, com a Terra ou a Lua ao fundo (duas passadas de desenho: os astros primeiro, a nave depois com a própria faixa de profundidade); o meio das viagens mostra a trajetória inteira. Estágios descartados aparecem ficando para trás (S-IC, S-II, S-IVB, estágio de subida, módulo de serviço). Terra em 4096 px com brilho do Sol no oceano e nuvens com estrutura fina; Lua em 4096 px com mapa de normais calculado do LOLA `ldem_16` em escala vertical real; no destino, um recorte do globo dá lugar ao relevo LOLA do app (real até ~120 km do local, nivelado até 150 km e esmaecido até 192 km), de modo que a órbita e a aproximação passam sobre o relevo medido. Luz devolvida pelo solo iluminado (Terra ou Lua) chega à nave.
- Continua ilustrativo o que já era (transferências, queimas, plumas, poeira, fumaça, arredores da plataforma). `check-mission` cobre a etapa nova.

## Missão: correções e render de cinema (15/11/2026, terceira rodada)

Problemas apontados pela equipe: a nave "girava sem parar" e a saída da Lua devia ser uma volta só.

- **Causa.** As órbitas lunares da Apollo 11 (13 voltas antes do pouso, 5 depois) cabiam em 10–12 s de animação: mais de uma volta por segundo, com a nave também rodando sobre o próprio eixo, porque a orientação era tirada só do vetor de velocidade.
- **Correção.** Cada órbita lunar é desenhada como uma única volta, contínua nas duas pontas, enquanto o relógio UTC e o contador percorrem as voltas reais (o painel avisa "a cena mostra uma volta").
- **Ajuste seguinte (pedido da equipe).** Na chegada, a cena vai direto ao ponto: a inserção lunar termina um quarto de volta antes da descida e só esse arco final é desenhado (5 s). O relógio e o contador continuam correndo as 13 voltas da Apollo 11; o painel avisa "a cena vai direto ao ponto de descida". A saída da Lua continua com uma volta. A rolagem da nave fica presa à vertical local do astro mais próximo.

Recursos novos, todos de fontes oficiais ou do próprio Three.js:

- **Modelos 3D da NASA** (`nasa/NASA-3D-Resources`, GLB): Módulo Lunar, separado nos dois estágios pela altura de cada peça, e a nave Apollo recortada do conjunto Apollo-Soyuz. As cores lisas viram os materiais da simulação (folha dourada amassada, alumínio, preto); as texturas da NASA (bandeira, letreiros, revestimento) são mantidas. O Saturn V continua sendo o modelo próprio: o GLB da NASA tem uma faixa azul que não existe no foguete real.
- **Render HDR.** A cena é desenhada em ponto flutuante com MSAA 4×; as fontes mais claras que o branco (chamas, Sol, plasma) passam por bloom; a saída usa ACES; por último, um passe de lente (franja cromática nos cantos, vinheta) e grão de filme.
- **Luz real na nave.** Sombras próprias da nave no espaço; dentro da sombra da Terra ou da Lua ela não recebe Sol (umbra, sem modelo de penumbra) e fica só com uma luz mínima; a luz devolvida pelo solo iluminado continua.
- **Reflexos reais.** A cada ~40 quadros a cena em volta da nave (Terra, Lua, Sol, estrelas) é capturada num cubo e filtrada (PMREM) para os reflexos do metal.
- **Céu.** Via Láctea do NASA SVS Deep Star Maps 2020, em coordenadas celestes, atrás das estrelas do catálogo HYG.
- A câmera treme com a queima do primeiro estágio na plataforma.

Medição no notebook de desenvolvimento (GPU integrada, Direct3D 11): 60 quadros por segundo nas etapas no espaço e 42 na descida.

## Missão: Terra, Lua, Sol e motores fisicamente baseados (15/11/2026, quinta rodada)

Pedido do Ricardo: "o realismo da Terra, da Lua, do Sol e da visão da missão ainda não está como queremos". Cada parte virou um módulo próprio, conferido contra fotos da NASA:

- **Terra e atmosfera** (`earth-render.js`): espalhamento de Hillaire (2020), com tabelas de transmitância, espalhamento múltiplo e irradiância calculadas na GPU. Mar com reflexo do Sol (Cox-Munk), terminador avermelhado, nuvens com sombra, luzes das cidades só depois do anoitecer, luar e airglow.
- **Texturas 8k da NASA**: Blue Marble NG (setembro de 2004, variante base), Black Marble 2016 em cinza, nuvens do Blue Marble 2002, máscara de água MODIS MOD44W (GIBS) e mosaico LROC WAC da Lua (SVS 4720). Elas entram depois que a cena já está na tela, só em telas com 8 GB de memória ou mais e ponteiro fino (não em celular). O envio para a GPU acontece com a missão pausada ou num corte de câmera.
- **Câmera e Sol** (`camera-fx.js`): disco solar com escurecimento de borda, reflexo de lente contido, exposição automática na GPU (no máximo 3 pontos de abertura nas vistas de perto), Via Láctea e estrelas HYG no brilho real.
- **Lua** (`lunar-surface.js`, `landing-site.js`): crateras procedurais num espaço comum da órbita ao solo, pedras em lei de potência e luz da Terra no lado escuro.
- **Motores e reentrada** (`spacecraft.js`):
  - F-1 com a forma que muda com a altitude (coluna no nível do mar, bulbo a 40–65 km);
  - J-2, SPS, DPS e APS quase invisíveis no vácuo;
  - detritos na decolagem lunar;
  - plasma da reentrada rosa-violeta no alto, que some abaixo de ~45 km.
- **Mar** (`ocean.js`): ondas por FFT (espectro de Elfouhaily), céu do mesmo modelo da atmosfera, cúmulos de alísio, borrifo na amerissagem e a cápsula balançando na água.

Licenças artísticas, declaradas também em "Dados e método":
- luzes noturnas, airglow e luar da Terra ampliados para aparecer;
- luz da Terra no lado escuro da Lua 400× no espaço (física no solo);
- chamas e plasma mais fracos que o real;
- nos diagramas da trajetória, céu como numa exposição longa (~20 pontos).

O que foi corrigido na integração:
- **Nave rosada na sombra:** a captura em cubo não limpava as faces e acumulava imagens antigas.
- **Trilha da decolagem com "bolinhas":** a luz da chama agora só alcança as nuvens perto do chão.
- **Risco de NaN:** três `pow()` podiam receber base negativa (com bloom, um NaN apaga a tela).
- **Reflexo:** a captura do reflexo da nave deixa de fora as licenças noturnas.

Medição no notebook de desenvolvimento (Intel integrada, Direct3D 11, 1600×900), com a GPU livre:
- **Velocidade:** 56–60 quadros por segundo no espaço e no mar; 30–32 na descida e no solo (eram ~42; as crateras finas custam ~5 ms).
- **Abertura:** a cena é montada em etapas, com o andamento na tela ("Preparando a cena 3D… n%"). Em seguida, um aquecimento desenha cada cenário uma vez, para que a reprodução não trave nas trocas de cena; sobram ~0,6 s num corte de câmera.
- **Custo da primeira abertura:** ~15–20 s neste iGPU, quase tudo compilação de shaders no primeiro quadro do espaço. Na segunda abertura o Chrome já guardou os programas e o tempo cai muito.
- **Memória:** abrir e fechar a missão três vezes não fez a memória crescer.

O que fica aquém:
- o anel do eclipse visto de longe é fraco (sem refração nem aerossóis estratosféricos);
- as nuvens são uma camada 2D;
- o relevo da Lua vista da órbita continua limitado pelo mapa de normais de 4096 px;
- a compilação inicial é lenta em Direct3D 11.

## Guia da primeira visita (15/11/2026)

Pedido do Ricardo: quem entra pela primeira vez recebe um guia que ensina o que cada coisa faz, sem aparecer toda hora. São nove passos sobre os controles reais (locais, o dia hora a hora, reprodução, vistas e observador, a resposta, o gráfico do relevo, a melhor janela, a missão e onde rever). O guia começa só depois do ritual de abertura, não trava a página (o escurecido deixa clicar), fecha com Esc, anda com as setas quando o foco está no cartão e grava a marca ao concluir ou pular; sem armazenamento, aparece uma vez por sessão. Conferido em 1536×864, 1366×768 (inglês), 900×1000 e 390×820, sem erros nem avisos no console; nenhum cartão cobre o próprio alvo.

## Eclipses e idioma inicial (15/11/2026)

- **Eclipses.** O Ricardo notou que em Malapert, às 03:20 UTC de 26/06/2029, a Terra aparecia exatamente na frente do Sol e o painel ainda marcava 1311 W/m². Nessa hora há um eclipse total da Lua visto da Terra; visto da Lua, a Terra cobre o Sol.
  - **Cálculo:** o modelo passou a calcular a fração do disco do Sol coberta pelo disco da Terra, vistos do local (área de interseção de dois círculos, com o raio da Terra alargado em 1/85 pela atmosfera, regra de Danjon).
  - **Efeito:** essa fração reduz a luz no painel, e o eclipse total tira o Sol das horas "com Sol" (trilhas, melhor janela e missão). O painel mostra "Eclipse total" ou "eclipse parcial", e a cena 3D escurece na mesma proporção.
  - **Conferido com o Astronomy Engine (`SearchLunarEclipse`):**
    - em 26/06/2029, o local entra na sombra total 71 min antes do pico e sai 79 min depois, dentro dos contatos da umbra (±110 min) e da totalidade geocêntrica (±51 min);
    - no eclipse parcial de 12/01/2028, só a borda sul da Lua entra na umbra, e o polo sul fica no escuro por ~48 min.

    O teste `check-model.mjs` cobre o caso de 2029. A luz vermelha refratada pela atmosfera da Terra não é modelada.
- **Idioma inicial:** o site abre em inglês (decisão do Ricardo, 15/11). O HTML estático já vem em inglês. Quem escolhe PT no botão continua em PT, e `?lang=pt` também funciona.

## Caminhada com capacete na vista Superfície (15/11/2026)

Pedido do Ricardo: "na visão da superfície, como se fôssemos o astronauta, até com o capacete, 100% real... eu ando com o boneco em cima da superfície".

- **Movimento.** Em primeira pessoa:
  - W A S D ou setas andam (← → giram), Shift corre, arrastar olha em volta; no celular, um direcional na tela;
  - 1,2 m/s andando e 2,5 m/s correndo; os olhos ficam na altura do observador, com um leve balanço da passada (desligado com "movimento reduzido").
- **Chão.** É o de `landing-site.js` (800 × 800 m, malha de 2 m, crateras de 5 a 150 m em geometria e menores no material, pedras em lei de potência), sem a plataforma aplainada da missão (`pad: false`). O ladrilho de 40 m ganha um furo onde ele fica, e a caminhada não sai da área detalhada.
- **Sombras.** Um corpo invisível de astronauta (pernas, tronco, mochila, braços e capacete, ~1,9 m) projeta a sombra. A luz principal mantém a sombra das cristas distantes (mapa de ±125 km), e um par de luzes na mesma direção dá as sombras próximas:
  - uma tem caixa de sombra de ±120 m em volta de você e desenha só o chão, as pedras e o corpo;
  - a outra é negativa e sem sombra.

  As duas se anulam, exceto dentro das sombras próximas, onde tiram a luz direta. A sombra principal só é redesenhada quando a luz, o relevo ou a vista mudam.
- **Composição.** A imagem usa uma lente deslocada (`setViewOffset`): o horizonte fica no meio da área que os painéis deixam livre.
- **Capacete.** Borda desfocada do casco, anel do pescoço e peito embaixo (como na Apollo, onde mal se viam os pés), reflexos na bolha e clarão do Sol no visor. O visor solar dourado imita o filme de ouro.
- **"Aqui".** Sol e Terra são testados contra o relevo a partir da posição do caminhante (centro do disco). Os números do painel continuam sendo os do ponto de referência; longe dele, os rótulos do Sol e da Terra na cena somem.
- **Medido no notebook de desenvolvimento** (1536×864): ~43 quadros por segundo andando, sem erros no console. Também conferido no celular (390×820) e em inglês.
