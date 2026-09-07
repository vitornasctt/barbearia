-- P5: distinguir uso do código (verificação de cadastro vs. reset de senha)
ALTER TABLE otp_codigos
  ADD COLUMN proposito VARCHAR(20) NOT NULL DEFAULT 'cadastro'
  CHECK (proposito IN ('cadastro','reset'));

CREATE INDEX idx_otp_celular_created ON otp_codigos (celular, created_at DESC);
