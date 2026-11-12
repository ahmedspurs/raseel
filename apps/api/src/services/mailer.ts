import nodemailer, { type Transporter } from 'nodemailer'
import type { Config } from '../config.js'

export interface Mail {
  to: string
  subject: string
  text: string
}

/** Sends email when SMTP_URL is configured; otherwise reports that it is disabled. */
export class Mailer {
  private transport: Transporter | null

  constructor(private readonly config: Config) {
    this.transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null
  }

  get enabled(): boolean {
    return this.transport !== null
  }

  async send(mail: Mail): Promise<boolean> {
    if (!this.transport) return false
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...mail })
    return true
  }
}
