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

## Cenas automáticas do OBS nos turnos de combate

Use o módulo RollSight para Foundry 1.1.91 ou posterior e ative o OBS Utils no mesmo mundo. Esses controles são separados das sobreposições de replays.

No OBS, crie as fontes de navegador do Foundry com o endereço do servidor fornecido pelo mestre: /game para a visão do jogo e /stream para o usuário Stream. Entre na fonte /stream com o usuário que será escolhido como operador do OBS.

Em cada fonte de navegador do Foundry, abra Propriedades e defina as permissões da página como acesso avançado ou completo. /game e /stream têm permissões separadas. Atualize cada fonte após alterá-las. Links apenas de replays não precisam de permissão para controlar cenas.

Mantenha o controlador /stream carregado durante as mudanças de cena. Desative o desligamento da fonte quando não estiver visível e reutilize a mesma fonte nas cenas. Essa conexão por fonte de navegador não exige WebSocket nem acesso à API do OBS Utils.

Como mestre, abra Configurações do jogo → RollSight → Configurar cenas do OBS por turno. Selecione o usuário Stream como operador do OBS e atualize as cenas do OBS. Escolha cada ator e sua cena nas listas. Opcionalmente, escolha cenas para PNJs sem associação e para o fim do combate.

Salve as cenas do OBS, ative a troca de cenas nos turnos de combate e deixe desmarcada a pausa da troca automática. Turnos de jogadores sem associação mantêm a cena atual.

As associações, o operador e as configurações de ativação e pausa ficam salvos neste mundo do Foundry. Stream pode se conectar após o início do servidor. Ao conectar, verifica o turno atual. A fonte precisa continuar conectada enquanto a troca automática for necessária.

Antes de transmitir, avance um turno em um combate de teste e confira a cena; depois teste pausa e retomada. Se faltarem cenas, confira as permissões de /stream, atualize seu cache do navegador e a lista. Após renomear cenas do OBS, selecione os novos nomes e salve novamente.
