export class PaginationQuery {
  public pageIndex: number; 
  public pageSize: number;
  public search?: string

  constructor(query:any) {
    this.pageIndex = Number.isSafeInteger(query.pageIndex) ? Number(query.pageIndex) : 0
    this.pageSize = Number.isSafeInteger(query.pageSize) ? Number(query.pageSize) : 0
    this.search = query.search
  }
}

type PaginationResponseConstructor = {
  result: any[],
  pageSize: number,
  rowCount: number
}

export class PaginationResponse {
  rows: any[]
  pageCount: number
  rowCount: number

  constructor({result, pageSize, rowCount}: PaginationResponseConstructor) {
    this.rows = result,
    this.pageCount = Math.ceil(rowCount / pageSize),
    this.rowCount = rowCount
  }
}