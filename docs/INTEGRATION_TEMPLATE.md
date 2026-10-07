# Integração da consulta de fotos — instruções para IA

Integre a FotoAPI na plataforma usando apenas as duas rotas de consulta abaixo. Base URL e API key são fornecidas pelo responsável pela API; os exemplos usam placeholders. Use uma chave de consulta, não a chave administrativa.

## Configuração

Configure PHOTO_API_URL e PHOTO_API_KEY no backend da plataforma. Centralize as chamadas em um serviço de integração e normalize o telefone com DDI explícito (8 a 15 dígitos). O país não é inferido.

## POST

Envie a API key no header X-Api-Key, Content-Type: application/json e o body com phone:

~~~sh
curl -X POST "https://fotoapi.exemplo/api/photos" -H "X-Api-Key: SUA_API_KEY" -H "Content-Type: application/json" --data '{"phone":"5511999999999"}'
~~~

## GET

Coloque o número no caminho e a API key no parâmetro apikey. Não envie body:

~~~sh
curl "https://fotoapi.exemplo/api/photos/5511999999999?apikey=123"
~~~

Substitua 123 pela chave ativa. Construa a query com URLSearchParams para codificar a chave corretamente. Não registre URLs completas com apikey em logs da plataforma.

## Resultado e tratamento

As duas rotas retornam o mesmo formato JSON. url identifica a foto arquivada, sourceUrl a URL original, savedAt o salvamento, expiresAt a validade e cacheHit indica reutilização. A imagem arquivada exige autorização ao ser carregada; o retorno de uma consulta não torna sua URL pública. Preserve as regras de acesso da plataforma ao exibir a imagem.

Cada consulta gera histórico, inclusive quando usa cache. Dentro do prazo configurado, a API reutiliza tanto a foto salva quanto o resultado não encontrado. Nesse segundo caso, retorna HTTP 404 com error, cacheHit, savedAt e expiresAt. cacheHit=true indica que o resultado veio do banco sem nova busca externa. TTL zero desativa ambos os tipos de cache. A exclusão do cache por número remove a validade dos dois tipos, preservando histórico. Falhas temporárias (502, 503, 504) não são armazenadas como não encontrado. Use timeout e limite de concorrência; exiba fallback quando a foto não estiver disponível. Em 429, respeite Retry-After. Trate 400 (entrada inválida), 401 (chave inválida/ausente), 404 (foto indisponível), 409 (conflito), 502 (falha externa), 503 (sem sessão disponível) e 504 (timeout). Não faça retries ilimitados.

Valide consulta por POST/header e GET/query, reutilização em cache e tratamento de erros com mocks antes do uso real. Não coloque credenciais reais em código, exemplos ou bundles do frontend.

## Referência das duas rotas de consulta
