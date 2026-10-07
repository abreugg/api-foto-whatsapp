# Validação desta entrega

- `npm test`: 45 testes passaram. Além dos fluxos de autorização, cache, logs e QR, verificam conversão e limites das unidades de duração, download autenticado do guia e documentação limitada às duas consultas. O GET aceita apikey na query; chaves inválidas, duplicadas ou desativadas são recusadas, e o POST não aceita chave na query. Avatar aceita tanto url da API real quanto URL documentado no YAML.
- `npm run check`: sintaxe validada nos arquivos JavaScript.
- `npm run format:check`: formatação conferida com Prettier.
- `npm audit --omit=dev`: nenhuma vulnerabilidade reportada nas dependências de produção no momento da entrega.
- Painel aberto no navegador: login por API key, salvamento de 24 meses (62.208.000 segundos), busca por número, exclusão do cache junto à foto com histórico preservado e filtros/detalhes da documentação conferidos. A prévia utilizou dados de teste, sem conexão real com WhatsApp.

## Ainda não verificado neste ambiente

Docker não está instalado/disponível. Não foi possível executar `docker compose up`, construir a imagem nem rodar o teste em MySQL real. O Compose, Dockerfile, schema e teste `npm run test:mysql` estão incluídos para essa validação.

Após a configuração real do `.env`, `/admin/users` da WUZAPI foi consultado com sucesso: HTTP 200 e uma conexão retornada. Os logs de desenvolvimento registraram status, duração e quantidade de conexões sem expor o token. Pareamento pelo QR e consulta de foto real ainda não foram realizados.

Atualização: consulta real de avatar retornou HTTP 200 com data.url. O adaptador corrigido normalizou o campo e baixou uma imagem JPEG de 98.257 bytes. Essa verificação não gravou a imagem no MySQL nem alterou o histórico; a persistência continua coberta pelos testes com repositório em memória.

O `.env` local tem chaves administrativas, segredo de criptografia e senhas de banco gerados aleatoriamente. O ZIP distribui apenas `.env.example`, sem credenciais. Para a pasta do projeto existente, preencha `WUZAPI_URL` e `WUZAPI_ADMIN_TOKEN` antes de iniciar.

Cache de não encontrado: testes cobrem reutilização, TTL, desativação, exclusão, métricas, histórico por consulta, concorrência e ausência de cache para erros temporários. O teste MySQL separado cobre persistência desse resultado entre instâncias de repositório; ainda não foi executado neste ambiente.
