import { OpenAI } from 'openai';
import openAiTools from './open-ai.tools';
import { ChatConfig } from './assistant/open-ai';

export default async function handleOpenAiTools(uid:string, toolCalls: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[], body: ChatConfig) {
  console.log('Handling tool calls...');
  const toolOutputs:{ tool_call_id: string; output: string; }[] = [];

  for (const toolCall of toolCalls) {
    const { function: { name, arguments: args } } = toolCall;
    console.log(`Processing tool call: ${name} with arguments:`, args);
    let result;

    switch (name) {
      case 'get_availability_to_visit_the_property':
        result = await openAiTools.get_availability_to_visit_the_property(uid, JSON.parse(args));
        break;
      case 'schedule_client_for_next_visit':
        result = await openAiTools.schedule_client_for_next_visit(uid, body, JSON.parse(args))
        break;
      case 'schedule_property_visit':
        result = await openAiTools.schedule_property_visit(uid, body, JSON.parse(args))
        break;
      case 'search_properties':
        result = await openAiTools.search_properties(uid, JSON.parse(args))
        break;
      case 'get_help':
        result = await openAiTools.get_help(uid, body, JSON.parse(args))
        break;
      default:
        result = { error: 'Función no reconocida' };
    }

    if (result) {
      console.log(`Tool call result for ${name}:`, result);
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(result),
      });
    }
  }

  return toolOutputs;
}