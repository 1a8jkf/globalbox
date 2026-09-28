# GLOBAL TERRITORY

**Build your world. Shape your land.**

MVP de um mundo compartilhado no navegador. Jogadores desenham fronteiras livres sobre a Terra, compram com saldo fictício, dão ordens de construção, acompanham moradores e negociam territórios. Toda propriedade é virtual. Nenhum gateway real está integrado.

## Executar

Requisitos: Node.js 24+, npm e Docker com Compose. O Compose usa rede do host Linux; em outras plataformas, configure PostgreSQL e Redis acessíveis pelas URLs locais correspondentes.

```bash
npm ci
npm run env:init
docker compose --env-file .env.local up -d
npm run db:generate
npm run db:deploy
npm run db:seed  # opcional: três comunidades demonstrativas
npm run dev
```

Abra http://localhost:5173. API em 3001, PostgreSQL em 55432 e Redis em 56379. `env:init` gera senhas aleatórias e mantém uma configuração existente. `.env.local` é privada e ignorada pelo Git. Não remova volumes para reiniciar os serviços.

Na sandbox desta tarefa, o Docker utiliza `unix:///home/vercel-sandbox/runtime/global-territory/docker.sock`. Use `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/global-territory/docker.sock docker compose --env-file .env.local up -d`. A restauração do daemon está documentada em `docs/sandbox.md`.

### Produção local

```bash
npm run build
NODE_ENV=production npm run start
```

A aplicação, API e WebSocket são servidos juntos em http://localhost:3001. Vite preview isolado não substitui o servidor multiplayer. Em implantação HTTPS configure `COOKIE_SECURE=true`; use `TRUST_PROXY=true` somente atrás de um proxy confiável de um salto. Persistência depende dos volumes PostgreSQL e Redis; PostgreSQL é a fonte de verdade. Faça backups regulares com `pg_dump` e teste a restauração antes de disponibilizar uma instalação pública.

## Jogar

- Explorar e buscar localidades dispensa login. Crie uma conta para receber R$ 100 fictícios.
- Aproxime uma região e selecione **Desenhar terra**. Arraste para traçar, ou use **Modo: vértices**. Nesse modo, clique para marcar; teclado: setas movem o cursor, Espaço marca, Enter fecha e Backspace desfaz.
- Revise área e preço. A cotação dura dois minutos. Confirme a compra simulada e nomeie sua comunidade.
- Abra **Construir** e dê uma ordem automática ou posicione dentro do território. Os construtores precisam alcançar o local. Fazendas permitem escolher a cultura.
- Em **Visão geral**, consulte produção/estoque e troque recursos na bolsa simulada. Anuncie o território ou faça ofertas a outros proprietários. Ofertas podem ser aceitas, recusadas ou contrapropostas.
- Mouse: arraste e use a roda. Touch: arraste/pince. `Home` retorna ao planeta. Menus: Tab/Shift+Tab, Enter e Esc; gamepad: direcional/analógico, A confirmar e B voltar. O login exige entrada de texto pelo dispositivo. No celular, o painel inferior pode ser recolhido.
- Camadas oferecem fronteiras, terreno, habitantes, recursos e tamanho do texto. Preferência de movimento reduzido diminui animação visual; o servidor continua simulando.
- `/@username` mostra perfil público. `/atlas.html` preserva o mundo anterior 16.384 × 8.192 em Equal Earth, separado da simulação multiplayer.

## Arquitetura e regras

- `src/game`: React para HUD, pilha de telas e acessibilidade; MapLibre para câmera Web Mercator; Canvas para personagens do anexo e sprites de terreno/construções próprios. Dispositivos sem WebGL2 usam uma câmera geográfica Canvas com os mesmos controles. Ambos recebem os mesmos blocos de terreno pixel art gerados em Worker a partir dos vetores locais Natural Earth; a resolução aumenta junto com o zoom.
- `server`: autenticação por scrypt e sessões revogáveis, geometria, comandos transacionais, economia e ciclos autoritativos. O cliente nunca determina dinheiro, propriedade, recursos ou resultados.
- `shared`: contratos de regiões e tabelas de balanceamento. `prisma`: esquema e migrações incrementais. Configurações de preço e recursos ficam em `GameConfig` no banco; o intervalo de ciclos é lido na inicialização.
- Fronteiras: GeoJSON Polygon com um anel, até 2.048 pontos recebidos e até 256 após simplificação. Área geodésica, sem autointerseção ou sobreposição. Limites iniciais: 0,05–5.000 km², latitude entre −80° e 80°, sem cruzar o antimeridiano e pelo menos 80% de terra firme segundo os vetores Natural Earth. Não são limites cadastrais reais.
- Malha 64 × 64 interna recortada pela fronteira, seis moradores iniciais e até 128 construções. Casas, fazendas, estradas, serrarias, minas, armazéns, mercados e prefeitura. Animais são detalhes decorativos determinísticos.
- Ciclo padrão de 3 segundos: deslocamento, necessidades, obras, agricultura e recursos. Recuperação após interrupção limitada a 300 segundos por ciclo; distância percorrida também é limitada para evitar saltos enormes. População inicial permanece fixa neste MVP. Prédios cívicos e estradas são fundações visuais; expansão urbana e redes econômicas avançadas vêm depois.
- PostgreSQL serializa mutações e ciclos com um advisory lock transacional. Essa escolha favorece integridade no MVP; não é uma arquitetura validada para milhares de jogadores. Débitos de construção/troca usam `requestId` e recibos; compras usam cotação ou chave idempotente. Reutilizar uma chave com outro comando é rejeitado.
- `/api/world` consulta limites geográficos e pagina por `cursor`; `/api/regions?ids=…` retorna até 12 simulações locais por lote. O navegador detalha até 24 territórios visíveis, mantém os demais como fronteiras e limita a 32 MiB os canvases estáticos de vegetação local. O terreno global Canvas tem cache de 64 MiB; no MapLibre o cache raster é limitado a 48 tiles. Sprites reutilizam um atlas de quadros. Outros usos de memória, como MapLibre, não fazem parte desse limite.
- WebSocket `/ws` aceita apenas `{type:"subscribe",bounds:{west,east,south,north}}`. Notificações carregam revisão e IDs relevantes. Eventos globais de comércio invalidam resumos. A reconexão recupera o estado por HTTP; Redis propaga notificações entre processos, sem guardar saldos ou propriedades.
- Bolsa de recursos: preços configuráveis pelo servidor. Comércio entre jogadores nesta fase é de territórios. `PaymentProvider` tem somente implementação `SIMULATED`.

## Dados e assets

Natural Earth 1:10m, domínio público, revisão `ca96624a56bd078437bca8184e78163e5039ad19`. Fontes/checksums em `data/geography/sources.json` e `public/map/source.json`. Dados preparados acompanham o projeto; nenhuma API externa é necessária durante o jogo.

```bash
npm run data:fetch     # baixar novamente os dados fixados
npm run data:prepare   # gerar os blocos do atlas anterior
npm run map:prepare    # preparar basemap pixelado e busca de localidades
```

Terreno, construções, ícones e interface são próprios do projeto; personagens civis foram extraídos do anexo fornecido pelo usuário. Assets são servidos localmente, sem uploads nem object storage obrigatório. As contas `demo_*` são comunidades demonstrativas, com senhas aleatórias não compartilhadas; não representam jogadores conectados.

## Verificar

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
npm audit
```

A integração cria um schema PostgreSQL isolado, executa uma API em 3002 com ciclos automáticos desativados e o remove ao terminar. Cobre dois clientes WebSocket, concorrência, idempotência, permissões, transferência, simulação e reinício do processo. Nunca utiliza/resetta o schema público como fixture.

Validação visual deve incluir 1440×900, 2560×1080, 390×844 e 844×390, tamanho de texto ampliado, foco de modais, modo reduzido e desenho por toque. Testes sintéticos não substituem validação em aparelhos físicos. Não há promessa de capacidade para milhares de usuários.

## Próximas etapas

Crescimento populacional e cidades, novas profissões, logística, fábricas, fortificações, exércitos abstratos, alianças, diplomacia, conquistas e eventos mundiais. Abertura pública também demanda operação, recuperação de contas e limites econômicos próprios de uma comunidade pública.

## Personagens e direção visual — setembro de 2026

O mapa local usa os personagens civis fornecidos pelo usuário: Worker, Farmer, Builder, Miner, Woodcutter e Trader. A imagem original está em `data/characters/reference.png`; `npm run characters:prepare` extrai 44 quadros com fundo transparente e gera os PNGs locais. Recortes e checksum estão em `public/characters/source.json`. As fichas de moradores usam os mesmos sprites. O arquivo entregue tinha o xadrez incorporado: o preparo remove o fundo neutro conectado às bordas, preservando detalhes internos claros.

`src/game/characters.ts` associa poses às tarefas do servidor; andar, trabalhar e descansar têm leitura própria. Movimento reduzido mantém uma pose estática. O terreno tem clareiras determinísticas, sombras, árvores variadas, pequenas flores e margens de água; trigo, milho, arroz, frutas e madeira possuem detalhes visuais próprios. A ficha completa anexada foi preservada em `docs/character-reference.md`. Atributos de combate, magia e cerco são referências futuras, não sistemas ativos; os valores atuais de saúde/energia da simulação permanecem em escala 0–100.

Para oferecer dinheiro por uma terra: abra o território → **Negociar** → informe o valor fictício → **Enviar oferta**. Não é necessário haver anúncio. O destinatário recebe a proposta em **Ofertas**, onde pode aceitar, recusar ou contrapropor. O saldo é verificado e debitado apenas na aceitação, junto com a transferência dos bens; propostas sem saldo suficiente não mudam o proprietário.

## Terreno pixel art e níveis de detalhe

- `src/terrain/clusters.ts`: motivos originais e paletas por bioma (grama, folhas, raízes, areia, rocha, neve, gelo, ondas e praias). As formas são agrupamentos discretos de pixels, não texturas fotográficas.
- `surface.ts`: raster visual 2× independente da malha geográfica, com faixas de profundidade, margens úmidas, praias oceânicas, sombras de relevo e motivos ancorados em coordenadas globais. A arte nunca modifica máscaras, biomas, elevação ou simulação.
- `geography.ts` + `worker.ts`: no multiplayer, projetam os dados locais em Web Mercator e rasterizam somente tiles visíveis de 256 células, com 32 células auxiliares em cada borda; produzem imagens de 512×512. Máscaras intermediárias são quantizadas; a imagem final usa pixels opacos e amostragem sem suavização. Dados vetoriais são carregados uma vez por Worker, sem API externa.
- `selection.ts` + `tiles.ts`: fila com um trabalho ativo, descarte de respostas antigas e liberação explícita de bitmaps. Canvas conserva a visão global e dois níveis anteriores durante a chegada dos detalhes, limitando o conjunto solicitado a 60 imagens e o cache a 64 MiB. MapLibre recebe PNGs pelo protocolo local `terrain://`, com interpolação nearest e sem fade.
- O atlas Equal Earth reutiliza `renderSurface` nos cinco níveis existentes e preserva seus blocos geográficos, câmera, árvores e animais. O cache do atlas permanece em 96 MiB incluindo arrays e imagens. As duas visualizações são páginas separadas.
- Solo e água são pré-renderizados: não há sorteio nem desenho de milhares de clusters a cada frame. A semente reproduz uma região após descarregá-la. Vegetação local transparente permite que a geografia permaneça visível também dentro das propriedades.

Os limites de cache não incluem vetores, buffers temporários, memória do navegador/GPU ou outras camadas. O relevo e as faixas de profundidade são ilustração geograficamente orientada, não batimetria ou altimetria científica. O detalhe aumenta por LOD; após a resolução máxima do atlas (128×), a câmera não inventa nova geografia.
