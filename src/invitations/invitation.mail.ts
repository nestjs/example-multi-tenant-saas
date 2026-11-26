import { Injectable } from '@nestjs/common';
import { html, type Mailable } from '@nestjs/mail';

export interface InvitationMailData {
  organization: string;
  invitedBy: string;
  url: string;
}

@Injectable()
export class InvitationMail implements Mailable<InvitationMailData> {
  render({ organization, invitedBy, url }: InvitationMailData) {
    return {
      subject: `Join ${organization}`,
      // `html` escapes every value: an organization named <script> stays text.
      html: html`
        <p>${invitedBy} invited you to join ${organization}.</p>
        <p><a href="${url}">Accept the invitation</a></p>
        <p>The link works once, within 7 days.</p>
      `,
    };
  }
}
