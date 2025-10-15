import db from "@/utils/db"
import aiClassification from "./ai-classification"
import { ChatConfig, getEmbbVector } from "./open-ai"

async function analyzeInterest(uid:string, body:ChatConfig, lastMessages:string) {
  try {
    const interestAnalysis = await aiClassification.analyzePropertyInterest(lastMessages)
  
    console.log('interestAnalysis')
    console.log(interestAnalysis)
    
    if(interestAnalysis.interested === false) {
      return
    }
    if(!interestAnalysis.customer_requirement) return

    let embeddings:number[] = []

    const similarInterests = await db.getSimilarCustomerRequestsProperties(uid,body, interestAnalysis.customer_requirement)
    console.log('similarInterests')
    console.log(similarInterests)
    if(!similarInterests) return;

    const previousSimilaRequirements = similarInterests.map(interest => interest.customer_requirement).filter(Boolean) as string[]
    const duplicatedResult = await aiClassification.isDuplicateInterest(interestAnalysis.customer_requirement, previousSimilaRequirements)
    if(duplicatedResult.is_duplicate) return;

    console.log('duplicatedResult')
    console.log(duplicatedResult)

    embeddings = await getEmbbVector(interestAnalysis.customer_requirement)
    if(!embeddings) return;
    await db.saveCustomerInterest(uid, interestAnalysis, body, embeddings)
  } catch (error) {
    console.error(error)
    return null
  }
}

export default {analyzeInterest} as const