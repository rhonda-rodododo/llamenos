---
title: Segurança e Privacidade
subtitle: O que é protegido, o que é visível e o que pode ser obtido por intimação — organizado pelos recursos que você usa.
---

## Se seu provedor de hospedagem for intimado

| Eles PODEM fornecer | Eles NÃO PODEM fornecer |
|---------------------|--------------------------|
| Metadados de chamadas/mensagens (horários, durações) | Conteúdo de notas, transcrições, corpos de relatórios |
| Blobs de banco de dados criptografados | Nomes de voluntários (criptografados de ponta a ponta) |
| Quais contas de voluntários estavam ativas e quando | Registros do diretório de contatos (criptografados de ponta a ponta) |
| | Conteúdo de mensagens (criptografado ao chegar, armazenado como texto cifrado) |
| | Chaves de descriptografia (protegidas pelo seu PIN, conta de provedor de identidade e chave de segurança de hardware opcional) |
| | Chaves de criptografia por nota (efêmeras — destruídas após o encapsulamento) |
| | Seu segredo HMAC para reverter hashes de telefone |

**O servidor armazena dados que não pode ler.** Metadados (quando, quanto tempo, quais contas) são visíveis. Conteúdo (o que foi dito, o que foi escrito, quem são seus contatos) não é.

---

## Por recurso

Sua exposição à privacidade depende dos canais que você habilita:

### Chamadas de voz

| Se você usar... | Acesso de terceiros possível | Acesso do servidor possível | Conteúdo criptografado de ponta a ponta |
|-----------------|-----------------------------|----------------------------|----------------------------------------|
| Twilio/SignalWire/Vonage/Plivo | Áudio da chamada (ao vivo), registros de chamadas | Metadados da chamada | Notas, transcrições |
| Asterisk auto-hospedado | Nada (sob seu controle) | Metadados da chamada | Notas, transcrições |
| Navegador para navegador (WebRTC) | Nada | Metadados da chamada | Notas, transcrições |

**Intimação ao provedor de telefonia**: Eles têm registros detalhados de chamadas (horários, números de telefone, durações). Eles NÃO TÊM notas de chamadas ou transcrições. A gravação está desativada por padrão.

**Transcrição**: A transcrição acontece inteiramente no seu navegador usando IA no dispositivo. **O áudio nunca sai do seu dispositivo.** Apenas a transcrição criptografada é armazenada.

### Mensagens de texto

| Canal | Acesso do provedor | Armazenamento no servidor | Notas |
|-------|-------------------|--------------------------|-------|
| SMS | Sua operadora de telefonia lê todas as mensagens | **Criptografado** | O provedor mantém as mensagens originais |
| WhatsApp | Meta lê todas as mensagens | **Criptografado** | O provedor mantém as mensagens originais |
| Signal | A rede Signal é criptografada de ponta a ponta, mas a ponte descriptografa ao chegar | **Criptografado** | Melhor que SMS, mas não é zero conhecimento |

**As mensagens são criptografadas em seu servidor assim que chegam.** O servidor armazena apenas o texto cifrado. Sua operadora de telefonia ou provedor de mensagens ainda pode ter a mensagem original — essa é uma limitação dessas plataformas, não algo que possamos mudar.

**Intimação ao provedor de mensagens**: Provedores de SMS têm o conteúdo completo das mensagens. Meta tem o conteúdo do WhatsApp. Mensagens Signal são criptografadas de ponta a ponta até a ponte, mas a ponte (executada em seu servidor) descriptografa antes de recriptografar para armazenamento. Em todos os casos, **seu servidor tem apenas texto cifrado** — o provedor de hospedagem não pode ler o conteúdo das mensagens.

### Notas, transcrições e relatórios

Todo conteúdo escrito por voluntários é criptografado de ponta a ponta:

- Cada nota usa uma **chave aleatória única** (sigilo de encaminhamento — o comprometimento de uma nota não compromete as outras)
- As chaves são encapsuladas separadamente para o voluntário e cada administrador
- O servidor armazena apenas o texto cifrado
- A descriptografia acontece no navegador
- **Campos personalizados, conteúdo de relatórios e anexos de arquivo são todos criptografados individualmente**

**Apreensão de dispositivo**: Sem seu PIN **E** acesso à sua conta de provedor de identidade, os atacantes só obtêm um blob criptografado computacionalmente inviável de descriptografar. Se você também usa uma chave de segurança de hardware, **três fatores independentes** protegem seus dados.

---

## Privacidade do número de telefone do voluntário

Quando os voluntários atendem chamadas em seus telefones pessoais, seus números são expostos ao seu provedor de telefonia.

| Cenário | Número de telefone visível para |
|---------|--------------------------------|
| Chamada PSTN para o telefone do voluntário | Provedor de telefonia, operadora de celular |
| Navegador para navegador (WebRTC) | Ninguém (o áudio permanece no navegador) |
| Asterisk auto-hospedado + telefone SIP | Apenas seu servidor Asterisk |

**Para proteger os números de telefone dos voluntários**: Use chamadas baseadas em navegador (WebRTC) ou forneça telefones SIP conectados a um Asterisk auto-hospedado.

---

## Lançado recentemente

Essas melhorias estão ativas agora:

| Recurso | Benefício de privacidade |
|---------|-------------------------|
| Armazenamento de mensagens criptografadas | Mensagens SMS, WhatsApp e Signal são armazenadas como texto cifrado em seu servidor |
| Transcrição no dispositivo | O áudio nunca sai do seu navegador — processado inteiramente em seu dispositivo |
| Proteção de chave multifator | Suas chaves de criptografia são protegidas pelo seu PIN, provedor de identidade e chave de segurança de hardware opcional |
| Chaves de segurança de hardware | As chaves físicas adicionam um terceiro fator que não pode ser comprometido remotamente |
| Builds reproduzíveis | Verifique se o código implantado corresponde ao código-fonte público |
| Diretório de contatos criptografado | Registros de contato, relacionamentos e notas são criptografados de ponta a ponta |

## Ainda planejado

| Recurso | Benefício de privacidade |
|---------|-------------------------|
| Aplicativos nativos para receber chamadas | Nenhum número de telefone pessoal exposto |

---

## Tabela de resumo

| Tipo de dados | Criptografado | Visível para o servidor | Obtível por intimação |
|---------------|---------------|------------------------|----------------------|
| Notas de chamadas | Sim (ponta a ponta) | Não | Apenas texto cifrado |
| Transcrições | Sim (ponta a ponta) | Não | Apenas texto cifrado |
| Relatórios | Sim (ponta a ponta) | Não | Apenas texto cifrado |
| Anexos de arquivo | Sim (ponta a ponta) | Não | Apenas texto cifrado |
| Registros de contato | Sim (ponta a ponta) | Não | Apenas texto cifrated |
| Identidades de voluntários | Sim (ponta a ponta) | Não | Apenas texto cifrated |
| Metadados de equipe/função | Sim (criptografado) | Não | Apenas texto cifrated |
| Definições de campos personalizados | Sim (criptografado) | Não | Apenas texto cifrated |
| Conteúdo SMS/WhatsApp/Signal | Sim (em seu servidor) | Não | Texto cifrado do seu servidor; o provedor pode ter o original |
| Metadados de chamadas | Não | Sim | Sim |
| Hashes de telefone dos chamadores | Hash HMAC | Apenas hash | Hash (não reversível sem seu segredo) |

---

## Para auditores de segurança

Documentação técnica:

- [Especificação do protocolo](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/protocol/llamenos-protocol.md)
- [Modelo de ameaças](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/THREAT_MODEL.md)
- [Classificação de dados](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/security/DATA_CLASSIFICATION.md)
- [Auditorias de segurança](https://github.com/rhonda-rodododo/llamenos/tree/main/docs/security)
- [Documentação da API](/api/docs)

O Llamenos é open source: [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
