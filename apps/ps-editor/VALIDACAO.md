# Validação da entrega — 10/11/2026

Pedido: fork de remotion-dev/remotion em Coding/Remotion PS e edição rápida inspirada no FilmCraft pessoal: hover audiovisual, cortes, descarte antes/depois, ajuste interno com T, UX simplificada e base para agentes sem API paga. Implementação: `apps/ps-editor`; a fork mantém o monorepo original.

## Evidências verificadas

- TypeScript: `bun run check`, aprovado. Build Vite de produção aprovado. Avisos restantes: anotação de tree-shaking da dependência Zod e tamanho do bundle (749,62 kB de JS, 230,62 kB gzip estimados pelo build). O servidor local serve os arquivos sem compressão; isso não é tráfego de nuvem.
- `bun test test`: **27 testes, 83 verificações, zero falhas**. Cortes, bordas, Slip, vínculos, troca com durações diferentes, limites de mídia, bloqueios, fechamento de espaços, atomicidade, tipos hostis, autorização local, origem, revisões, idempotência, desfazer/refazer, recuperação e reinício do servidor.
- Navegador Chrome, interface real, perfil pessoal de teste com dados sintéticos. Sem visualização de suporte ou privilégios administrativos; o editor pessoal não tem perfis de proprietário/membro.
- Hover: playhead azul permaneceu em **00:00:15**, vídeo alcançou **4,5 s** do original sob o cursor, retornou a **2,5 s** ao sair. Cursor laranja apareceu e desapareceu. Instrumentação de Web Audio observou buffers reais, RMS máximo **0,2121**, 10 inícios e 10 interrupções ao final dos movimentos. Isso prova decodificação/agendamento e interrupção, não uma avaliação subjetiva de caixas de som.
- Slip com **T**: arraste mostrou mídia em **4 s**, mantendo o playhead em **00:01:00**. `sourceIn` foi de 60 para 90 frames, posição 0 e duração 120 preservadas. A revisão mudou uma única vez ao soltar; nenhuma escrita durante a prévia. Undo e Escape preservaram/recuperaram o original.
- Interface: Cmd+B dividiu vídeo e áudio; vírgula/ponto descartaram no frame apontado; trilha inferior impediu fechamento indevido do intervalo. Troca por arraste preservou clipes. Texto `.,t` permaneceu no campo de nome. Recarregar preservou fontes, timeline e histórico.
- Áudio separado: duas partes vinculadas foram cortadas em conjunto. Faixa bloqueada recusou o corte sem mudar revisão ou clipes. A primeira asserção desse teste leu a revisão antes de a gravação do bloqueio terminar; a inspeção confirmou apenas a operação de bloquear, com os 3 clipes intactos. A prova foi corrigida para esperar o estado real da interface e passou, sem mudar o requisito.
- Agentes: verificar plano não gravou; aplicar foi uma transação; undo recuperou; plano com revisão antiga foi recusado. CLI `context`, `preview`, `apply` e rejeição de reenvio com revisão obsoleta passaram. Uma conexão SSE reflete mudanças externas na interface.
- Ociosidade: **0 novos pedidos HTTP em 3,5 segundos**, após estabilização da página e das mídias. Não mede todos os tamanhos de projeto nem equivale a um benchmark de um mês. Não há polling ou API de modelo. Conexão SSE é encerrada em falha e exige reabrir a página, evitando retries infinitos.
- Visual: desktop 1440×900 e móvel 390×844 inspecionados. No móvel, largura do documento = 390 px e painel recolhido. Controles avançados permanecem em painéis/menu. Detector Impeccable retornou `[]`.

## Exportação real e correção de cor

O fluxo **Exportar vídeo → progresso → Baixar MP4** foi usado no build de produção. Arquivo final: **8,000 s, 240 frames, 30 fps, 960×540, H.264/yuv420p, BT.709 limitado, AAC**, 1.664.011 bytes. Áudio medido: média **−15,8 dB**, pico **−10,4 dB**. Os dois inícios de plano correspondem aos frames de origem **60 (2 s)** e **180 (6 s)**.

A primeira exportação tinha desvio visível de cor. O caso foi reduzido a um único frame PNG: a captura HTML do vídeo já mostrava o desvio antes da codificação. Trocar para `OffthreadVideo` manteve a prévia do Player e extraiu o frame original no render. A saída foi configurada explicitamente com PNG, BT.709 e yuv420p. Amostras de áreas uniformes no MP4 final ficaram a até **2 níveis RGB** da referência, contra desvios de até **69 níveis** na primeira saída. PSNR RGB do primeiro frame subiu de **19,18 para 31,68 dB** em relação ao original escalado.

A exportação é com perdas e inclui escala/subamostragem: não é idêntica pixel a pixel. SSIM RGB bruto dessa imagem de teste saturada ficou em 0,834 (primeiro plano) e 0,821 (segundo), portanto não se declara fidelidade universal ou saída lossless. Não foi atribuído defeito ao fornecedor sem prova; o caminho HTML foi substituído por uma alternativa nativa do Remotion com resultado comparável verificado. Uma tentativa durante desenvolvimento foi interrompida por recarga HMR; o fluxo foi retestado em produção estável e concluiu.

## Limites da prova

Não se executou a suíte inteira do monorepo Remotion nem benchmark de 2.000 clipes, 4K/HDR, VFR, todos os codecs ou mídia de 2 horas. Os limites e custos estão no README. Não houve contratação, deploy na nuvem, chamada de IA paga ou alteração do FilmCraft. O formato de projeto visual é próprio; projetos React arbitrários não são convertidos automaticamente.

Arquivos de evidência usados durante o trabalho: screenshots e scripts em `work/ps-editor` da raiz da fork, mais um MP4 final de demonstração em `apps/ps-editor/local-data/exports`. Temporários dispensáveis são removidos ao concluir. Mídia sintética foi gerada localmente por `scripts/demo.ts`, sem conteúdo privado ou assets de terceiros.

## Correção após revisão independente

A revisão do candidato inicial identificou que uma troca de extremos com durações diferentes deslocava o vídeo intermediário, mas não seu áudio vinculado em outra faixa (30 frames de desvio no caso mínimo). O deslocamento agora inclui todos os parceiros intermediários uma única vez. Bloqueios e colisões desses parceiros recusam a transação inteira. Três regressões adicionais passaram: sincronização, parceiro bloqueado e colisão. No navegador, o caso mínimo terminou com vídeo e áudio no frame **90**, desvio **0**, mesma posição durante a prévia, uma única gravação ao soltar e recuperação de ambos ao frame 60 por Undo. A timeline sintética anterior foi restaurada após o teste. Sem alterações de renderização e sem nova exportação desnecessária nessa correção.
