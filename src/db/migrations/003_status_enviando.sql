ALTER TABLE mensagens_whatsapp DROP CONSTRAINT IF EXISTS mensagens_whatsapp_status_envio_check;
ALTER TABLE mensagens_whatsapp ADD CONSTRAINT mensagens_whatsapp_status_envio_check
  CHECK (status_envio IN ('pendente','enviando','enviado','entregue','falha','simulado'));
