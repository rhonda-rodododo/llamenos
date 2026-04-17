---
title: Recursos
subtitle: Tudo o que uma plataforma de resposta a crises precisa, em um pacote open-source. Voz, SMS, WhatsApp, Signal e relatórios criptografados — auto-hospedado para controle máximo.
---

## Telefonia multi-provedor

**5 provedores de voz** — Escolha entre Twilio, SignalWire, Vonage, Plivo ou Asterisk auto-hospedado. Configure seu provedor na interface de configurações do administrador ou durante o assistente de configuração. Mude de provedor a qualquer momento sem alterar o código.

**Chamadas via navegador WebRTC** — Voluntários podem atender chamadas diretamente no navegador, sem telefone. Geração de tokens WebRTC específicos por provedor para Twilio, SignalWire, Vonage e Plivo. Preferência de chamada configurável por voluntário (telefone, navegador ou ambos).

## Roteamento de chamadas

**Toque paralelo** — Quando um chamador liga, todos os voluntários em plantão e não ocupados tocam simultaneamente. O primeiro a atender recebe a chamada; os outros toques param imediatamente.

**Agendamento baseado em turnos** — Crie turnos recorrentes com dias e horários específicos. Atribua voluntários aos turnos. O sistema roteia automaticamente as chamadas para quem está de plantão.

**Fila com música de espera** — Se todos os voluntários estiverem ocupados, os chamadores entram em uma fila com música de espera configurável. O tempo limite da fila é ajustável (30-300 segundos). Se ninguém atender, as chamadas vão para o correio de voz.

**Recuo para correio de voz** — Os chamadores podem deixar uma mensagem de voz (até 5 minutos) se nenhum voluntário atender. As mensagens de voz são transcritas via Whisper AI e criptografadas para revisão do administrador.

## Notas criptografadas

**Anotação de ponta a ponta** — Voluntários escrevem notas durante e após a chamada. As notas são criptografadas no lado do cliente usando ECIES (secp256k1 + XChaCha20-Poly1305) antes de sair do navegador. O servidor armazena apenas o texto cifrado.

**Criptografia dupla** — Cada nota é criptografada duas vezes: uma para o voluntário que a escreveu e outra para o administrador. Ambos podem descriptografar independentemente. Ninguém mais pode ler o conteúdo.

**Campos personalizados** — Administradores definem campos personalizados para notas: texto, número, seleção, caixa de seleção, área de texto. Os campos são criptografados junto com o conteúdo da nota.

**Salvamento automático de rascunhos** — As notas são salvas automaticamente como rascunhos criptografados no navegador. Se a página for recarregada ou o voluntário sair, o trabalho dele é preservado. Os rascunhos são apagados no logout.

## Transcrição de IA

**Transcrição no dispositivo** — As chamadas são transcritas usando IA executada inteiramente no navegador do voluntário. O áudio nunca sai do dispositivo. Apenas a transcrição criptografada é armazenada.

**Controles de administrador e voluntário** — Administradores podem ativar ou desativar a transcrição globalmente. Voluntários podem optar por não participar individualmente. Os dois interruptores são independentes.

**Transcrições criptografadas** — As transcrições usam a mesma criptografia ECIES das notas. A transcrição armazenada é apenas texto cifrado.

## Mitigação de spam

**CAPTCHA de voz** — Detecção opcional de robôs de voz: o chamador ouve um número aleatório de 4 dígitos e deve digitá-lo no teclado. Bloqueia discagem automática enquanto permanece acessível para chamadores reais.

**Limitação de taxa** — Janela deslizante de limitação de taxa por número de telefone, persistida no banco de dados. Os limites configuráveis sobrevivem a reinicializações.

**Listas de banimento em tempo real** — Administradores gerenciam listas de banimento de números de telefone com entrada única ou importação em massa. Os banimentos entram em vigor imediatamente. Os chamadores banidos ouvem uma mensagem de rejeição.

**Prompts IVR personalizados** — Grave prompts de voz personalizados para cada idioma suportado. O sistema usa suas gravações para fluxos de IVR, recuando para texto para fala quando não há gravação.

## Mensagens multicanal

**SMS** — Mensagens SMS de entrada e saída via Twilio, SignalWire, Vonage ou Plivo. Resposta automática com mensagens de boas-vindas configuráveis. As mensagens fluem para uma visualização de conversa em tópicos.

**WhatsApp Business** — Conecte-se via Meta Cloud API (Graph API v21.0). Suporte a mensagens de modelo para iniciar conversas dentro da janela de mensagens de 24 horas. Suporte a mensagens de mídia para imagens, documentos e áudio.

**Signal** — Mensagens focadas em privacidade via uma ponte signal-cli-rest-api auto-hospedada. Monitoramento de saúde com degradação elegante. Transcrição de mensagens de voz via Whisper AI no dispositivo.

**Conversas em tópicos** — Todos os canais de mensagens fluem para uma visualização de conversa unificada. Balões de mensagem com carimbos de data/hora e indicadores de direção. Atualizações em tempo real. Todas as mensagens são criptografadas em seu servidor assim que chegam. O servidor armazena apenas o texto cifrado.

## Relatórios criptografados

**Função de denunciante** — Uma função dedicada para pessoas que enviam dicas ou relatórios. Os denunciantes veem apenas uma interface simplificada com relatórios e ajuda. Convidados através do mesmo fluxo dos voluntários, com seletor de função.

**Submissões criptografadas** — O corpo do relatório é criptografado usando ECIES antes de sair do navegador. Os títulos em texto simples são para triagem, o conteúdo criptografado é para privacidade. Os anexos de arquivo são criptografados separadamente.

**Fluxo de trabalho de relatórios** — Categorias para organizar relatórios. Acompanhamento de status (aberto, reivindicado, resolvido). Administradores podem reivindicar relatórios e responder com respostas criptografadas em tópicos.

## Diretório de contatos

**Registros de contato criptografados** — Armazene informações de contato com criptografia de ponta a ponta. Nomes, números de telefone, e-mails e notas são criptografados antes de sair do navegador.

**Rastreamento de relacionamentos** — Vincule contatos uns aos outros e a chamadas, conversas e relatórios. Construa uma imagem completa de quem você está ajudando.

**Vinculação automática** — Chamadas e mensagens recebidas são automaticamente vinculadas a contatos conhecidos pela correspondência de números de telefone.

**Acesso baseado em equipe** — Controle quais membros da equipe podem ver quais contatos. As permissões são granulares e configuráveis.

**Etiquetas e intake** — Organize contatos com etiquetas. Os fluxos de intake direcionam novos contatos para revisão.

**Importação/exportação em massa** — Importe contatos de CSV ou JSON. Exporte backups criptografados. Todo o processamento acontece em seu navegador.

## Permissões configuráveis

**Funções personalizadas** — Defina suas próprias funções com exatamente as permissões de que precisa. Comece a partir dos modelos integrados (Administrador, Voluntário, Denunciante) ou construa do zero.

**Permissões granulares** — Mais de 90 permissões individuais em 17 áreas de recursos. Controle quem pode visualizar, criar, editar e excluir em um nível fino.

**Escopo por equipe** — Atribua membros da equipe a equipes. As permissões podem ser limitadas a equipes específicas, para que grupos diferentes vejam dados diferentes.

## Painel do administrador

**Assistente de configuração** — Configuração guiada em várias etapas no primeiro login do administrador. Escolha quais canais habilitar (Voz, SMS, WhatsApp, Signal, Relatórios), configure os provedores e defina o nome da sua linha direta.

**Lista de verificação de primeiros passos** — Widget do painel que acompanha o progresso da configuração: configuração de canais, integração de voluntários, criação de turnos.

**Monitoramento em tempo real** — Veja chamadas ativas, chamadores em fila, conversas e status de voluntários em tempo real. As métricas são atualizadas instantaneamente.

**Gerenciamento de usuários** — Convide novos membros da equipe por meio de links seguros. Eles criam suas próprias contas e chaves de criptografia. Gerencie funções, permissões e atribuições de equipe.

**Registro de auditoria** — Cada chamada atendida, nota criada, mensagem enviada, relatório enviado, configuração alterada e ação administrativa é registrada. Visualizador paginado para administradores.

**Histórico de chamadas** — Histórico de chamadas pesquisável e filtrável com intervalos de datas, pesquisa por número de telefone e atribuição de voluntário. Exportação de dados em conformidade com o GDPR.

**Ajuda no aplicativo** — Seções de FAQ, guias específicos por função, cartões de referência rápida para atalhos de teclado e segurança. Acessível na barra lateral e na paleta de comandos.

## Experiência do voluntário

**Paleta de comandos** — Pressione Ctrl+K (ou Cmd+K no Mac) para acesso instantâneo à navegação, pesquisa, criação rápida de notas e alternância de tema. Os comandos apenas para administradores são filtrados por função.

**Notificações em tempo real** — Chamadas recebidas disparam toque do navegador, notificação push e título da aba piscando. Alterne cada tipo de notificação independentemente nas configurações.

**Presença do voluntário** — Administradores veem contagens em tempo real de online, offline e em pausa. Voluntários podem alternar o interruptor de pausa na barra lateral para pausar temporariamente as chamadas recebidas sem sair do turno.

**Atalhos de teclado** — Pressione ? para ver todos os atalhos disponíveis. Navegue pelas páginas, abra a paleta de comandos e execute ações comuns sem tocar no mouse.

**Salvamento automático de rascunhos de notas** — As notas são salvas automaticamente como rascunhos criptografados no navegador. Se a página for recarregada ou o voluntário sair, o trabalho dele é preservado. Os rascunhos são apagados do localStorage no logout.

**Exportação de dados criptografada** — Exporte notas como um arquivo criptografado (.enc) em conformidade com o GDPR, protegido por sua chave de criptografia multifator. Apenas o autor original pode descriptografar a exportação.

**Temas escuro/claro** — Alterne entre modo escuro, modo claro ou seguir o tema do sistema. A preferência persiste por sessão.

## Multilíngue e móvel

**12+ idiomas** — Traduções completas da interface: Inglês, Espanhol, Chinês, Tagalo, Vietnamita, Árabe, Francês, Crioulo Haitiano, Coreano, Russo, Hindi, Português e Alemão. Suporte a RTL para Árabe.

**Aplicativo Web Progressivo** — Instalável em qualquer dispositivo via navegador. O service worker armazena em cache o shell do aplicativo para lançamento offline. Notificações push para chamadas recebidas.

**Design mobile-first** — Layout responsivo projetado para telefones e tablets. Barra lateral recolhível, controles amigáveis ao toque e layouts adaptativos.

## Autenticação e gerenciamento de chaves

**Proteção de chave multifator** — Sua chave de criptografia é protegida por até três fatores independentes: um PIN escolhido por você, sua conta de provedor de identidade e uma chave de segurança de hardware opcional. O comprometimento de qualquer fator único não é suficiente.

**Integração com provedor de identidade** — Gerenciamento de identidade auto-hospedado (sob seu controle). Integração baseada em convites — nenhuma compartilhamento de chaves secretas. Revogação remota de sessão — bloqueie um dispositivo comprometido de qualquer lugar.

**Gerenciamento automático de sessões** — As sessões são atualizadas silenciosamente em segundo plano. O bloqueio automático por inatividade protege dispositivos desatendidos. Sua chave de criptografia vive em um processo isolado, nunca acessível pela página.

**Vinculação de dispositivos** — Configure novos dispositivos com segurança. Escaneie um código QR ou insira um código de provisionamento curto. Usa troca de chaves efêmera — sua chave secreta nunca é exposta durante a transferência.

**Chaves de recuperação** — Durante a integração, você recebe uma chave de recuperação para emergências. Backup criptografado obrigatório antes de continuar.

**Chaves de segurança de hardware** — Suporte opcional a passkey para login resistente a phishing. Registre uma chave de hardware ou biométrica e faça login sem digitar credenciais.

**Sigilo de encaminhamento por nota** — Cada nota é criptografada usando uma chave aleatória única, e essa chave é encapsulada via ECIES para cada leitor autorizado. O comprometimento da chave de identidade não revela notas anteriores.
