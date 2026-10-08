# Lunar Horizon 3D

Explorador do polo sul lunar em português. Site estático com Three.js 0.186.1, efemérides do Astronomy Engine 2.1.19 e terreno real do LRO/LOLA, sem dependência de APIs no navegador para os cálculos.

## Executar

No Windows, dê dois cliques em **Iniciar Lunar Horizon.cmd** ou execute `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1` na pasta do projeto. Abra `http://localhost:4173/`. Esse inicializador usa o Node.js disponível (incluindo o runtime do Codex), inicia um processo independente do terminal temporário e serve apenas em `127.0.0.1` e `::1`. Não cria serviço, tarefa agendada, entrada de inicialização ou publicação. Uma segunda execução apenas verifica o servidor existente; uma porta ocupada por outro processo não é liberada automaticamente. Os registros ficam em `artifacts/localhost-server.log`.

Como alternativa em um terminal que permanecerá aberto, execute `npm start` (Node.js) ou `python -m http.server 4173 --bind 127.0.0.1 --directory dist` e use `http://127.0.0.1:4173/`. Os arquivos de bibliotecas, texturas e terreno necessários já estão em `dist`. Não é necessário instalar dependências para executar a versão entregue. Após reiniciar o computador, execute o inicializador novamente.

Para desenvolvimento e reprodução dos dados: instale as versões fixadas com `pnpm install`. `pnpm prepare:data` obtém as linhas polares do DEM NASA por HTTP Range, gera as cinco malhas binárias e copia as bibliotecas locais. `pnpm check` verifica a geometria e um caso de referência JPL. A regeneração dos dados precisa de rede; o servidor estático e os cálculos não.

## Tutorial ilustrado

Abra `http://localhost:4173/tutorial.html` ou clique em **Tutorial** no cabeçalho do aplicativo. O guia inclui capturas reais, parâmetros reproduzíveis, comparação de casos favoráveis e obstruídos, busca de janela comum, missão Terra–Lua–Terra, entradas rejeitadas e conclusões que o modelo não permite. O botão **Imprimir guia** usa a impressão do navegador, com opção de salvar como PDF. Os exemplos podem ser recalculados com `node scripts/tutorial-examples.mjs`.

## Recursos do aplicativo

- Câmeras de relevo orbital, superfície e globo lunar; interação por mouse, toque e teclado (setas / Home).
- Terreno regional de 100 × 100 km, amostrado em 257 × 257 pontos, com curvatura lunar e escala vertical 1×.
- Efemérides e luz solar sincronizadas à data UTC; tamanho angular do Sol e da Terra baseado na distância.
- Horizonte local em 360°, comparação de até três locais e cronograma das próximas 24 horas.
- Irradiância incidente para painel rastreado ou horizontal, altura do observador de 2–20 m e animação temporal.
- Busca do maior intervalo contínuo de Sol e centro da Terra visíveis em todos os locais selecionados nos próximos 30 dias (passo de 1 hora).
- WebMCP: `configure_lunar_comparison` e `read_lunar_visibility`, com parâmetros validados antes de qualquer mudança de estado.
- Missão Terra–Lua–Terra: lançamento, órbita terrestre, injeção translunar, viagem, inserção e órbita lunar, pouso, permanência, decolagem, órbita lunar de retorno, injeção à Terra e reentrada. Usa o local em foco e a janela calculada, ou uma janela manual iniciada na data escolhida.
- Controles de reprodução, velocidade, etapas e câmera; seleção e janela lembradas apenas neste navegador.

## Simulação de missão

Escolha os locais, clique em **Melhor janela**, coloque em foco um dos locais dessa comparação e abra **Simular missão**. O pouso ocorre no início da janela. O lançamento é antecipado pela duração da ida, e a decolagem acontece após a permanência informada, que precisa caber na janela. Sem busca, a data selecionada inicia uma janela manual de 24 h, ajustável na simulação. Valores iniciais de 72 h de ida, até 24 h de permanência e 72 h de volta são hipóteses educativas, não parâmetros de um veículo.

As posições geocêntricas da Lua e sua orientação são recalculadas pela efeméride. O estacionamento terrestre é uma órbita circular a **300 km**, com **1,5 volta**; o lunar fica a **100 km do raio médio**, com **1 volta antes do pouso e 1 após a decolagem**. As órbitas são soluções analíticas de dois corpos em planos EQJ fixos: `T = 2π√(r³/μ)` e `v = √(μ/r)`. Os parâmetros [JPL DE440](https://ssd.jpl.nasa.gov/astro_par.html) são 398600,435507 km³/s² para a Terra e 4902,800118 km³/s² para a Lua. Os períodos são aproximadamente **90,5 min** e **117,8 min**, com velocidades circulares de **7,73 km/s** e **1,63 km/s**. Durante essas etapas os motores ficam desligados. Não há estilingue gravitacional nem cálculo de economia de combustível.

Os tempos das órbitas, subida, descida e queimas estão **incluídos** nas durações totais da ida e da volta; não deslocam o pouso para fora da janela. O estacionamento lunar usa um plano polar educativo que alcança a região selecionada. A Lua acompanha sua efeméride enquanto o veículo orbita ao redor dela. As fases de TLI (6 min), LOI (6 min) e TEI (3 min) são manobras visuais. A subida terrestre dura 12 min; a descida e a subida lunares, 15 min cada. Esses números são hipóteses do modelo, não uma reconstrução Apollo.

As transferências continuam sendo curvas Bézier com correção visual pela posição da Lua; os controles são escolhidos para não cruzar as esferas da Terra e da Lua em 1001 amostras. Essa verificação geométrica não é validação orbital. Subida, descida e reentrada também são interpoladas. Há continuidade de posição, **não garantia de continuidade de velocidade** entre essas etapas e as órbitas. Não há solução de Lambert, integração de três corpos, orçamento de delta-v, consumo, estágios ou atmosfera. A referência terrestre permanece no Cabo Canaveral e a atitude da textura é visual. A viagem não é uma previsão de voo. Uma janela de iluminação e visada **não é** uma janela orbital.

Distâncias e raios planetários são proporcionais na visão espacial; o veículo é ampliado para leitura. A câmera automática enquadra cada órbita e passa ao DEM nos últimos 400 m acima do nível do destino, com transições de enquadramento interpoladas. A reprodução completa dura 140 s em 1× (70 s em 2×, 35 s em 4×). Descida e subida têm 20 s cada: os últimos 15 s da descida e os primeiros 14 s da subida mostram o foguete próximo do solo. O veículo mantém a orientação prógrada nas órbitas e inicia a rotação para a vertical apenas durante a descida. Junções Bézier adicionais igualam a derivada da posição em relação ao progresso da animação nas entradas/saídas das transferências; isso não garante continuidade da velocidade física no UTC, comprimido diferentemente em cada etapa. Nas etapas locais, a malha usa quilômetros e o veículo genérico mede ~14 m. O grão de rególito é apenas material visual. O DEM de ~474 m não resolve o contato das pernas; obstáculos na descida não são verificados. A altitude orbital é relativa ao raio de referência do corpo; nas etapas locais é relativa ao nível do destino. As condições são avaliadas **no destino lunar**, não durante o voo. O relógio UTC é cronológico, mas a animação comprime o tempo separadamente por etapa.

`node scripts/check-mission.mjs` verifica as 13 etapas, datas, continuidade de posição, períodos e velocidades de Kepler, fechamento das órbitas, motores desligados no estacionamento, pouso e retorno. Também verifica ligações geométricas para os cinco locais e durações de 24/72/240 h. Fundamentos: [NASA Basics of Space Flight](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/).

## Dados e limitações

O DEM vem do [CGI Moon Kit da NASA SVS](https://svs.gsfc.nasa.gov/4720/), produto `ldem_64_uint.tif`. Os valores são alturas em meios metros acrescidas de 10 km, relativas ao raio lunar 1737,4 km. A distância meridional entre amostras é ~474 m. A grade entregue interpola esse produto; não melhora sua resolução original.

O cálculo usa vetores geométricos EQJ e a orientação IAU_MOON do [Astronomy Engine](https://github.com/cosinekitty/astronomy), equivalente à aproximação trigonométrica documentada no [NAIF PCK00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc). A posição do observador é subtraída para incluir paralaxe. A Lua é esférica com relevo, sem atmosfera. O horizonte é amostrado em raios de 50 km, em incrementos de 250 m e direções de 0,5°.

Visibilidade da Terra significa linha de visada para seu centro; não confirma um enlace nem uma estação terrestre específica. A irradiância usa a distância ao Sol, a fração do disco acima do horizonte e a orientação ideal do painel. Não é potência elétrica e não inclui eficiência, temperatura ou armazenamento. A sombra do renderizador é uma aproximação visual; os indicadores usam o perfil numérico. A cena inclui uma luz de leitura fraca. A rotação da textura terrestre é ilustrativa. O globo usa textura global, sem relevo global deslocado; o relevo regional é reconstruído do DEM.

Os pontos são referências regionais, não locais de pouso certificados. Gerlache e Haworth não são apresentados como cumes: a altitude do ponto selecionado no DEM é baixa. Foi corrigida a referência de Shackleton de 89,90°S para 89,66°S, para explorar um ponto de borda elevado; essa escolha está explicitamente visível na interface.

Uso educativo e exploratório. Estudos de missão precisam de DEM polar mais fino, kernels binários de orientação SPICE e validação de enlace. Textura lunar: NASA SVS/LROC; textura terrestre: exemplo de planetas do Three.js. Bibliotecas: MIT, licenças em `dist/vendor`.

## Avaliação e validação

Veja [EVALUATION.md](EVALUATION.md) para os problemas da versão inicial, mudanças e limites medidos.
