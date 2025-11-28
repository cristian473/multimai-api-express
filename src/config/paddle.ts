import { Paddle, Environment } from '@paddle/paddle-node-sdk';

// Paddle SDK initialization
const paddleApiKey = process.env.PADDLE_API_KEY;

if (!paddleApiKey) {
  console.warn('PADDLE_API_KEY is not set. Paddle functionality will be disabled.');
}

// Use sandbox environment for testing, production for live
const environment = process.env.NODE_ENV === 'production' 
  ? Environment.production 
  : Environment.sandbox;

export const paddle = paddleApiKey 
  ? new Paddle(paddleApiKey, { environment })
  : null;

// Webhook secret for verifying Paddle webhooks
export const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';

// Plan configuration with Paddle IDs
export const PADDLE_PLANS = {
  basic: {
    id: 'basic',
    name: 'Multimai Básico',
    productId: 'pro_01kb37bt76xpgjprqak1xdsb69',
    priceIdMonthly: 'pri_01kb37cbymgy685m78aarvd1xv',
    priceIdYearly: 'pri_01kb37ceh9k0cv9gk82rps4cpb',
    features: [
      '100 respuestas de mensajes por día',
      'Acceso total a la plataforma',
      'Sin soporte directo'
    ],
    limits: {
      messagesPerDay: 100
    }
  },
  pro: {
    id: 'pro',
    name: 'Multimai Pro',
    productId: 'pro_01kb37bw92vkefyksfwrzbgjkv',
    priceIdMonthly: 'pri_01kb37chpnyeqr6wccr9fjzyd3',
    priceIdYearly: 'pri_01kb37cm7b1ag0zmnm7mdcvyjm',
    features: [
      '1.000 respuestas de mensajes por día',
      'Acceso total a la plataforma',
      'Soporte por Email (48hs hábiles)'
    ],
    limits: {
      messagesPerDay: 1000
    }
  },
  enterprise: {
    id: 'enterprise',
    name: 'Multimai Enterprise',
    productId: 'pro_01kb37bxnpt8fkxm2z18t9twph',
    priceIdMonthly: 'pri_01kb37cq165ax8e8yc7fd6wyk9',
    priceIdYearly: 'pri_01kb37csv8vj6t05fvrn0rd5q3',
    features: [
      'Sin límite de respuestas (Ilimitado)',
      'Acceso total a la plataforma',
      'Soporte prioritario 24/7'
    ],
    limits: {
      messagesPerDay: -1 // Unlimited
    }
  }
} as const;

// Discount code for 40% off first payment
export const PADDLE_DISCOUNT_CODE = 'LAUNCH40';
export const PADDLE_DISCOUNT_ID = 'dsc_01kb37d86b8741b39vcgbbdasv';

// Helper to get plan by price ID
export function getPlanByPriceId(priceId: string) {
  for (const plan of Object.values(PADDLE_PLANS)) {
    if (plan.priceIdMonthly === priceId || plan.priceIdYearly === priceId) {
      return {
        ...plan,
        billingCycle: plan.priceIdMonthly === priceId ? 'monthly' : 'yearly'
      };
    }
  }
  return null;
}

// Helper to get plan by product ID
export function getPlanByProductId(productId: string) {
  for (const plan of Object.values(PADDLE_PLANS)) {
    if (plan.productId === productId) {
      return plan;
    }
  }
  return null;
}

export type PlanId = keyof typeof PADDLE_PLANS;
export type PaddlePlan = typeof PADDLE_PLANS[PlanId];

