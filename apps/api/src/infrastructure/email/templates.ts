/**
 * Email templates (Handlebars). Kept in code, not .hbs files, so `tsc` ships them in dist/ and a missing
 * file can never send an empty email. Every template also gets appName, appUrl and year.
 */

const layout = (body: string) => `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  ${body}
  <p style="margin-top:32px;color:#888;font-size:12px">© {{year}} {{appName}}</p>
</div>`;

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;

export const TEMPLATES: Record<string, string> = {
  welcome: layout(`
    <h2>Welcome to {{appName}}{{#if name}}, {{name}}{{/if}}!</h2>
    <p>Your account is ready. Please confirm your email address to finish setting up.</p>
    ${button('{{verifyUrl}}', 'Confirm my email')}
    <p style="color:#555;font-size:13px">If you didn't sign up, you can ignore this email.</p>`),

  otp: layout(`
    <h2>Your login code</h2>
    <p>{{#if name}}Hi {{name}}, use{{else}}Use{{/if}} this code to sign in to {{appName}}:</p>
    <p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">{{otp}}</p>
    <p style="color:#555">It expires in {{expiresIn}}. Never share this code with anyone.</p>`),

  'password-reset': layout(`
    <h2>Reset your password</h2>
    <p>{{#if name}}Hi {{name}}, we{{else}}We{{/if}} received a request to reset your {{appName}} password.</p>
    ${button('{{resetUrl}}', 'Choose a new password')}
    <p style="color:#555;font-size:13px">The link expires soon and works once. If you didn't ask for this, ignore this email; your password stays the same.</p>`),

  invoice: layout(`
    <h2>Invoice {{invoiceNumber}}</h2>
    <p>Dear {{customerName}},</p>
    <p>Please find your invoice for <strong>{{amount}}</strong>{{#if dueDate}}, due by {{dueDate}}{{/if}}.</p>
    {{#if viewUrl}}${button('{{viewUrl}}', 'View invoice')}{{/if}}
    <p>Thank you for your business.</p>`),

  'payment-reminder': layout(`
    <h2>Payment reminder</h2>
    <p>Dear {{customerName}},</p>
    <p>This is a friendly reminder that invoice <strong>{{invoiceNumber}}</strong> for <strong>{{amount}}</strong>{{#if dueDate}} was due on {{dueDate}}{{/if}}.</p>
    {{#if payUrl}}${button('{{payUrl}}', 'Pay now')}{{/if}}
    <p>If you've already paid, please ignore this message.</p>`),

  'low-stock': layout(`
    <h2>Low stock alert</h2>
    <p>These items are at or below their reorder point:</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><th align="left">Item</th><th align="right">In stock</th><th align="right">Reorder at</th></tr>
      {{#each products}}<tr><td>{{name}}{{#if sku}} ({{sku}}){{/if}}</td><td align="right">{{currentStock}}</td><td align="right">{{reorderPoint}}</td></tr>{{/each}}
    </table>`),

  'smtp-test': layout(`
    <h2>Your email is connected</h2>
    <p>{{appName}} can now send emails for <strong>{{organizationName}}</strong> from <strong>{{fromEmail}}</strong>.</p>
    <p style="color:#555">Sales reports, and later invoices and reminders to your customers, will come from this address.</p>`),
};
