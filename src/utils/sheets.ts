import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';

interface WebhookRow {
  numero: string;
  webhook: string;
  comando?: string;
}

class GoogleSheetsClient {
  private sheet: GoogleSpreadsheet;
  
  constructor(spreadsheetId: string) {
    this.sheet = new GoogleSpreadsheet(spreadsheetId, new JWT({
      email: process.env.GOOGLE_AUTH_CLIENT_EMAIL,
      key: process.env.GOOGLE_AUTH_PRIVATE_KEY,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    }));
  }

  /**
   * Gets the webhook URL for a given phone number
   * @param phoneNumber - The phone number to search for
   * @returns The webhook URL or null if not found
   */
  async getWebhook(phoneNumber: string): Promise<string | null> {
    const rows = (await this.getRows()).map((r) => r.toObject() as WebhookRow);
    const row = rows.find(row => row.numero === phoneNumber);
    return row?.webhook || null;
  }

  /**
   * Gets the webhook URL for a given phone number and command
   * @param phoneNumber - The phone number to search for
   * @param command - The command to search for
   * @returns The webhook URL or null if not found
   */
  async getWebhookByCommand(phoneNumber: string, command: string): Promise<string | null> {
    const rows = (await this.getRows()).map((r) => r.toObject() as WebhookRow);
    const row = rows.find(row => row.numero === phoneNumber && row.comando === command);
    return row?.webhook || null;
  }

  /**
   * Checks if a phone number exists in the sheet
   * @param phoneNumber - The phone number to check
   * @returns True if the number exists, false otherwise
   */
  async existsNumber(phoneNumber: string): Promise<boolean> {
    const rows = (await this.getRows()).map((r) => r.toObject() as WebhookRow);
    const exists = rows.some(row => row.numero === phoneNumber);
    return exists;
  }

  private async getRows(): Promise<GoogleSpreadsheetRow[]> {
    await this.sheet.loadInfo();
    const worksheet = this.sheet.sheetsByIndex[0]; // Assumes first worksheet
    return await worksheet.getRows();
  }
}

const sheet = new GoogleSheetsClient(process.env.GOOGLE_SHEET_ID)

export default sheet