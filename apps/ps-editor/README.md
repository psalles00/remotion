# Remotion PS

Editor visual local acrescentado à fork de Remotion. Feito para os cortes rápidos do FilmCraft pessoal do Pedro e para agentes que editam a mesma timeline por comandos. Não é uma cópia completa de todas as ferramentas do FilmCraft.

## Abrir

Na raiz da fork, dê dois cliques em **Iniciar Remotion PS.command**. Abre `http://127.0.0.1:4173`. O Terminal mantém o servidor; Control+C encerra. A primeira execução instala dependências locais e compila. As seguintes reutilizam o build. Todo o projeto, dependências e cache ficam no disco externo.

Requisitos do Mac: Node/npm para o primeiro setup, Chrome em `/Applications/Google Chrome.app`, FFmpeg e ffprobe em `/opt/homebrew/bin`. Não instala nem inicia Docker, VMs ou modelos locais. Caminhos alternativos: `REMOTION_PS_CHROME`, `REMOTION_PS_FFMPEG`, `REMOTION_PS_FFPROBE`; porta em `REMOTION_PS_PORT`. O uso atual já está configurado e verificado no Mac do Pedro.

Desenvolvimento (na pasta deste README):

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun run dev
bun run check
bun test test
bun run build
```

O modo de desenvolvimento usa diretamente `../../packages/core/src` e `../../packages/player/src` por aliases do Vite. O render usa `remotion`, bundler e renderer publicados, todos fixados na mesma versão 4.0.542 do checkout. As ferramentas originais de Studio e React permanecem na fork; este editor tem seu próprio estado de projeto e não converte projetos arbitrários do Studio automaticamente.

## Editar

- Importe vídeo, áudio ou imagem. Arraste da biblioteca à faixa, ou dê dois cliques para adicionar no final da primeira faixa compatível.
- Passe o mouse pela timeline: o cursor **laranja** mostra a prévia; o **azul** guarda o ponto de reprodução. Sair restaura a imagem e interrompe o som. Os botões olho/som permitem ligar cada prévia separadamente. O navegador precisa de um clique inicial para permitir áudio.
- **V** seleciona/move; **C** ativa a lâmina; **Cmd+B** corta no cursor; **,** descarta antes; **.** descarta depois. Sob o mouse, o clipe apontado tem prioridade; fora da timeline valem a seleção e o cursor azul.
- **T** ajusta o trecho interno (Slip). Arraste o corpo: posição e duração não mudam. O monitor e a onda mostram a prévia; uma barra indica a janela usada dentro da mídia. Limites dos originais e parceiros vinculados são respeitados. Confirma uma edição ao soltar; **Esc** cancela.
- Arrastar sobre outro clipe troca suas posições. No mesmo track, durações diferentes deslocam os clipes intermediários para preservar o conteúdo. Em **Mais opções de edição**, desative a troca para mover somente para espaços livres. Sobreposição involuntária é recusada.
- Arraste as bordas para ajustar início/fim. **S** alterna encaixe; **Cmd+−/+** muda o zoom; setas percorrem frames; Espaço reproduz a partir do cursor laranja quando disponível.
- **Cmd+Z / Cmd+Shift+Z** desfaz/refaz. **Backspace** remove; **Shift+Backspace** remove e tenta fechar o espaço.
- O descarte e a remoção só fecham o intervalo recém-esvaziado quando não existe conteúdo em nenhuma faixa, inclusive silenciada/bloqueada. Uma faixa posterior bloqueada impede fechar o espaço inteiro. Não remove espaços antigos nem encurta clipes vizinhos.
- Propriedades frequentes aparecem ao selecionar. Volume, transformação, duplicação, remoção e separação de áudio ficam no painel; as opções menos usadas ficam recolhidas. Áudio separado permanece vinculado e acompanha cortes, trims, movimentos e Slip. Vínculos incompatíveis impedem troca entre clipes.

## Dados, histórico e exportação

`local-data/project.json` contém o projeto ativo e até 50 operações de desfazer/refazer. Cada edição é gravada por renomeação atômica antes da confirmação. `project.json.recovery` guarda o último arquivo válido. Uma falha de leitura não sobrescreve o projeto; informa o arquivo a recuperar. `local-data/media` preserva os arquivos importados; originais externos não são alterados. Importe uma vez e reutilize o item na biblioteca para evitar duplicatas.

O menu do nome cria uma nova timeline mantendo a biblioteca e salva/abre cópias JSON. Criar uma timeline também é desfazível. Elas referenciam a biblioteca **deste Mac**; não são um pacote portátil de mídias. Não existe sincronização remota. Para transportar, preserve também `local-data/media`. Guarde os dados e a recuperação antes de qualquer remoção manual.

**Exportar vídeo** usa a mesma composição React, fontes originais e mixagem do preview: MP4/H.264 com AAC. Usa extração de frames por OffthreadVideo e exportação BT.709/PNG para preservar a cor. Salva em `local-data/exports` e oferece download. Uma exportação por vez, 2 frames simultâneos, até 10 minutos por vídeo; cancelar interrompe e remove a saída parcial. Formatos: 1080p horizontal, vertical, quadrado e prévia 960×540. O FPS do projeto é fixo em 30 nesta versão. Mídias importadas: até 2 GB / 2 horas, até 200 itens / 2.000 clipes / 24 faixas. São limites locais de proteção, não garantias de fluidez nesses extremos. Reprodução depende dos codecs suportados pelo Chrome; prefira MP4/H.264/AAC, WebM, WAV, MP3, PNG/JPEG/WebP. MOV/HEVC podem precisar de conversão externa antes da edição.

## Comandos para agentes — sem API paga

No painel **Agentes**, exporte o contexto com revisão e IDs reais. Cole uma lista JSON, confira o resumo e aplique como uma única operação desfazível. Também aceita `{ "revision": 12, "commands": [...] }`; uma revisão diferente é recusada. Editar o plano invalida a prévia. Mudanças posteriores na timeline exigem nova verificação.

Pelo terminal, com o editor aberto:

```sh
bun scripts/agent.ts context
bun scripts/agent.ts preview /caminho/plano.json
bun scripts/agent.ts apply /caminho/plano.json
```

Arquivo de plano (copie a revisão/ID retornados por `context`):

```json
{"revision":12,"commands":[{"type":"split","clipId":"ID-real","frame":90},{"type":"slip","clipId":"ID-real","delta":30}]}
```

Tempos são inteiros em **frames de projeto**; intervalos incluem o início e excluem o fim. `sourceIn` usa o mesmo FPS. Slip positivo avança na mídia; o arraste humano inverte o deslocamento para acompanhar o conteúdo sob o mouse.

Catálogo (`src/model.ts` é o contrato tipado):

| type | Campos |
|---|---|
| split | clipId, frame |
| trim | clipId, frame, side: before/after, closeGap: boolean |
| slip | clipId, delta |
| resize | clipId, edge: start/end, frame |
| move | clipId, from, trackId |
| swap | clipId, targetId |
| add | assetId, trackId, from, sourceIn, duration |
| delete | clipId, closeGap |
| duplicate | clipId |
| update | clipId, values: name/volume/opacity/scale/x/y |
| detach-audio | clipId |
| track | trackId, values: name/locked/muted |
| new-track | kind: video/audio |
| settings | values: name/width/height |
| batch | commands: lista de até 100; sem planos aninhados |

HTTP: `GET /api/session` retorna estado e capacidade temporária da sessão. Não exponha esse token em logs. `POST /api/command` recebe `{revision, requestId, command}`, `Content-Type: application/json` e `X-Remotion-PS-Token`. `/api/undo` e `/api/redo` usam o mesmo envelope sem command. Conflito de revisão retorna 409; não tente automaticamente com a nova revisão. `requestId` deduplica os últimos 64 envios da sessão. O CLI faz zero retries. A prévia não grava nada. Cada batch confirma tudo ou recusa tudo. Outras janelas recebem mudanças por uma conexão SSE, sem polling.

Escopo de confiança: servidor pessoal, apenas `127.0.0.1`, sem contas/admin/clientes ou acesso multiusuário. Token impede escritas vindas de outras páginas; Host e Origin são validados. Arquivos e URLs remotos não são aceitos nos projetos. Um processo local com acesso ao Mac pode usar a API, conforme sua autorização. Não publique este servidor diretamente na internet.

## Custos e consumo — 10/11/2026

Esta camada não contrata serviços, armazena mídia na nuvem nem chama modelos de IA. Há uso local de disco/CPU/RAM e da licença Remotion. [Preços oficiais](https://www.remotion.dev/docs/license/pricing): indivíduos e empresas até 3 pessoas podem usar a licença gratuita, sujeitos aos termos. Fora dela, Automators custa US$0,01/render, mínimo US$100/mês; Creators, US$25/assento/mês. A elegibilidade de uma futura distribuição comercial precisa ser conferida antes da ativação; não foi contratado plano. Estes valores de licença não incluem infraestrutura futura, impostos/câmbio ou APIs de IA ainda não escolhidas. Não há previsão de custo para um produto hospedado nesta entrega.

Orçamento da camada adicionada: zero chamadas remotas por gesto/minuto ocioso/ciclo. Ação confirmada: um POST local e uma notificação por janela; gesto: uma gravação ao soltar; arraste e hover calculam prévias locais. Inicialização: um GET e um SSE por janela, além dos assets locais. Importação: uma cópia local do arquivo, um probe, uma extração de waveform com resultado limitado a 256 valores, thumbnail opcional; processos têm timeout e tamanho de saída limitado. Mídias sem waveform mostram o estado simples de áudio.

Áudio de hover: trechos de 10 s, mono 16 kHz; até 2 pedidos em voo; servidor guarda até 6 trechos (aprox. 1,92 MB PCM), navegador até 6 buffers (aprox. 3,84 MB float). Até 8 clipes ativos são auditionados; trechos já em cache não geram I/O. Cada atualização sonora tem pelo menos 70 ms de intervalo; falhas não são repetidas continuamente e exigem reativar a opção. Sair interrompe os nós. O player pode fazer leituras locais por HTTP Range ao buscar novos pontos de vídeo. Não há promessa de 60 fps para qualquer mídia.

Renderização: uma conexão de progresso por exportação, sem polling, concorrência 2, cache de vídeo de 128 MiB, cache de mídia de 64 MiB e arquivos de trabalho reutilizados em `work/render-bundle`. O renderizador 4.0.542 é chamado sem chave de licença, conforme comportamento padrão; não registra evento remoto de uso nesse modo. Downloads iniciais de dependências/binaries são distintos do funcionamento ocioso. Chrome já instalado evita baixar outro browser. Exportações concluídas e mídias são dados do usuário: não são apagados automaticamente.

As medições da entrega estão em `VALIDACAO.md`; projeções e limites acima não equivalem a medições de escala máxima.
