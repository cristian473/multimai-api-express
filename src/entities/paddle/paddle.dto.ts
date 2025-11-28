import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly'
}

export class CreateCheckoutDto {
  @IsString()
  uid!: string;

  @IsString()
  priceId!: string;

  @IsOptional()
  @IsString()
  discountCode?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;
}

export class GetSubscriptionDto {
  @IsString()
  uid!: string;
}

export class CancelSubscriptionDto {
  @IsString()
  uid!: string;

  @IsOptional()
  @IsEnum(['immediately', 'next_billing_period'])
  effectiveFrom?: 'immediately' | 'next_billing_period';
}

export class CreatePortalSessionDto {
  @IsString()
  uid!: string;
}

// Paddle webhook event types
export type PaddleWebhookEventType = 
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.activated'
  | 'subscription.past_due'
  | 'subscription.trialing'
  | 'transaction.completed'
  | 'transaction.payment_failed'
  | 'customer.created'
  | 'customer.updated';

// Subscription status from Paddle
export type PaddleSubscriptionStatus = 
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'paused';

// Internal subscription status (includes expired for trial)
export type SubscriptionStatus = PaddleSubscriptionStatus | 'expired' | 'free_trial';

export interface UserSubscription {
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  paddlePriceId: string | null;
  planId: 'basic' | 'pro' | 'enterprise' | 'free_trial';
  billingCycle: 'monthly' | 'yearly' | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
}

