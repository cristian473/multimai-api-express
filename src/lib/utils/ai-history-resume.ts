type ChatMessage = {
  role: string;
  content: string;
}

export async function getLastMessages(
  currentMessage: string | undefined,
  history: ChatMessage[],
  limit: number = 150
): Promise<string> {
  const recentMessages = history.slice(-limit);

  let historyText = recentMessages
    .map(msg => `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}`)
    .join('\n');

  if (currentMessage) {
    historyText += `\nUsuario: ${currentMessage}`;
  }

  return historyText;
}

export default {
  getLastMessages
};
