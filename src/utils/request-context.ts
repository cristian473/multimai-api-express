const requestContext = new Map<string, any>()

function set(data: any) {
  const currentContext = requestContext.get('context')
  if (currentContext) {
    data = { ...currentContext, ...data }
  }
  requestContext.set('context', data)
}

function get() {
  return requestContext.get('context')
}

function clear() {
  requestContext.delete('context')
}

export default {
  set,
  get,
  clear
} as const
