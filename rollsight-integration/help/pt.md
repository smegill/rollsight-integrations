# Dados físicos do RollSight

No Foundry, abra as configurações do RollSight e copie seu código de jogador. Em Configurações do jogo → Principal → Dados, defina o método padrão como dados físicos do RollSight e salve. Confira as configurações individuais de cada dado. Inicie a rolagem no Foundry e aguarde a solicitação do RollSight antes de rolar os dados físicos.

## Vincular este mundo (GM)

O GM deve vincular este mundo antes de você atualizar seu código de jogador.

Copie este código pessoal no aplicativo de desktop. Selecione RollSight ou Manual na configuração de dados do Foundry e inicie uma rolagem no Foundry.

Inicie sua rolagem no Foundry e envie dados físicos pelo aplicativo de desktop. Solicitações remotas de rolagem ao desktop não são compatíveis.

## Aceitar dados para rolagens manuais

Também preenche solicitações manuais nativas. O Foundry mantém seus controles e calcula os modificadores.

Novas solicitações recebem dados automaticamente. Se várias estiverem abertas, a mais recente recebe primeiro; as anteriores retomam quando ela é fechada.

## Receber dados do RollSight

Desative para sair desta sessão. As rolagens pendentes continuam disponíveis no Foundry para conclusão manual.

## Usar a extensão do navegador

Receba resultados locais pela extensão do RollSight. A recepção pela nuvem fica desativada neste modo.

Este navegador não pode coordenar abas. Use apenas uma aba do Foundry por jogador do RollSight.

## Publicar dados sem rolagens pendentes

Publica dados físicos simples com a visibilidade atual do chat. Inicie primeiro iniciativa, ataques e vantagem no Foundry.

## Replay do RollSight

Abra o replay; selecione a imagem para ver em tamanho completo.

## Atualizar conexão

O RollSight não conseguiu conectar. Verifique o vínculo do mundo e atualize seu código de jogador nas configurações do módulo.

Outra aba recebe os dados do RollSight para este jogador. Feche-a e atualize esta conexão.

Os dados não foram aceitos. Envie valores inteiros no intervalo de cada dado.

O RollSight não conseguiu aplicar este envio. Verifique a rolagem pendente antes de enviar novamente.

## Cenas de combate opcionais do OBS

Em Configurações do jogo → RollSight, escolha **Configurar cenas do OBS por turno**. Selecione o usuário do Foundry conectado à Browser Source OBS Utils `/stream`. Associe os atores aos nomes exatos das cenas existentes no OBS e, se quiser, escolha cenas para turnos de NPC sem associação e para o fim do combate. Turnos de jogadores sem associação mantêm a cena atual. Salve e ative **Alternar cenas do OBS a cada turno de combate**. Use **Pausar a troca automática de cenas do OBS** para controlar manualmente; salve para retomar no turno atual.

Esse recurso usa a conexão existente do OBS Utils ou a permissão de controle de cenas da Browser Source do OBS. Não é necessária outra senha do OBS nem atualização do aplicativo de desktop. Use uma única fonte controladora e uma URL segura do Foundry (HTTPS ou localhost). Mantenha essa fonte carregada ao trocar cenas do OBS para que ela continue recebendo os turnos. Se o OBS Utils não oferecer a API necessária, atualize-o antes de ativar esse recurso. Se uma cena não existir ou a conexão do OBS cair, a cena atual será mantida; confira a grafia do nome da cena e a conexão do OBS Utils. Faça um teste na sua coleção de cenas antes de transmitir ao vivo.
