import { paddle, getPlanByPriceId, PADDLE_WEBHOOK_SECRET, PADDLE_PLANS, PADDLE_DISCOUNT_ID } from '../../config/paddle';
import { subscriptionsRepository } from '../../lib/db/repositories/subscriptions';
import { wsProxyClient } from '../../lib/other/wsProxyClient';
import type { UserSubscription, SubscriptionStatus } from './paddle.dto';
import { EventName } from '@paddle/paddle-node-sdk';

class PaddleService {
  /**
   * Create a checkout session for a user
   * If user is in trial, subscription will start after trial ends
   */
  async createCheckout(
    uid: string,
    priceId: string,
    customerEmail?: string,
    discountCode?: string
  ): Promise<{ checkoutUrl: string; startsAfterTrial?: boolean; startsAt?: Date } | null> {
    if (!paddle) {
      throw new Error('Paddle is not configured');
    }

    try {
      // Get or create Paddle customer
      let paddleCustomerId = await subscriptionsRepository.getPaddleCustomerId(uid);
      
      if (!paddleCustomerId && customerEmail) {
        // Create customer in Paddle
        const customer = await paddle.customers.create({
          email: customerEmail,
          customData: { firebaseUid: uid }
        });
        paddleCustomerId = customer.id;
        await subscriptionsRepository.updatePaddleCustomerId(uid, paddleCustomerId);
      }

      // Check if user is in trial and get trial end date
      const isInTrial = await subscriptionsRepository.isInTrial(uid);
      const trialEndDate = await subscriptionsRepository.getTrialEndDate(uid);
      
      // Determine when the billing should start
      let billingStartsAt: Date | undefined;
      let startsAfterTrial = false;
      
      if (isInTrial && trialEndDate && trialEndDate > new Date()) {
        // User is in trial - subscription starts after trial ends
        billingStartsAt = trialEndDate;
        startsAfterTrial = true;
        console.log(`User ${uid} is in trial. Subscription will start after trial ends on ${trialEndDate.toISOString()}`);
      }

      // Get plan info for pending plan display
      const plan = getPlanByPriceId(priceId);

      // Create transaction for checkout
      const transactionData: any = {
        items: [{ priceId, quantity: 1 }],
        // Add custom data to track the Firebase UID and deferred billing
        customData: { 
          firebaseUid: uid,
          startsAfterTrial: startsAfterTrial,
          billingStartsAt: billingStartsAt?.toISOString(),
          planId: plan?.id,
          planName: plan?.name,
          billingCycle: plan?.billingCycle,
        },
      };

      if (paddleCustomerId) {
        transactionData.customerId = paddleCustomerId;
      }

      // Apply discount if requested (use actual discount ID, not code)
      if (discountCode === 'LAUNCH40' || discountCode === PADDLE_DISCOUNT_ID) {
        transactionData.discountId = PADDLE_DISCOUNT_ID;
      }

      const transaction = await paddle.transactions.create(transactionData);

      // Return the checkout URL from transaction
      let checkoutUrl: string;
      if (transaction.checkout?.url) {
        checkoutUrl = transaction.checkout.url;
      } else {
        // If no checkout URL, construct it manually using the transaction ID
        // This happens when default checkout URL is not configured
        const checkoutBaseUrl = process.env.NODE_ENV === 'production'
          ? 'https://checkout.paddle.com'
          : 'https://sandbox-checkout.paddle.com';
        
        checkoutUrl = `${checkoutBaseUrl}/checkout/custom?_ptxn=${transaction.id}`;
      }

      return { 
        checkoutUrl, 
        startsAfterTrial,
        startsAt: billingStartsAt 
      };
    } catch (error) {
      console.error('Error creating checkout:', error);
      throw error;
    }
  }

  /**
   * Get subscription for a user
   */
  async getSubscription(uid: string): Promise<UserSubscription | null> {
    try {
      return await subscriptionsRepository.getSubscription(uid);
    } catch (error) {
      console.error('Error getting subscription:', error);
      throw error;
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(
    uid: string,
    effectiveFrom: 'immediately' | 'next_billing_period' = 'next_billing_period'
  ): Promise<boolean> {
    if (!paddle) {
      throw new Error('Paddle is not configured');
    }

    try {
      const subscription = await subscriptionsRepository.getSubscription(uid);
      
      if (!subscription?.paddleSubscriptionId) {
        throw new Error('No active subscription found');
      }

      await paddle.subscriptions.cancel(subscription.paddleSubscriptionId, {
        effectiveFrom
      });

      return true;
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw error;
    }
  }

  /**
   * Create a customer portal session
   */
  async createPortalSession(uid: string): Promise<{ url: string } | null> {
    if (!paddle) {
      throw new Error('Paddle is not configured');
    }

    try {
      const subscription = await subscriptionsRepository.getSubscription(uid);
      
      if (!subscription?.paddleCustomerId) {
        throw new Error('No customer found');
      }

      const subscriptionIds = subscription.paddleSubscriptionId 
        ? [subscription.paddleSubscriptionId] 
        : [];

      const portalSession = await paddle.customerPortalSessions.create(
        subscription.paddleCustomerId,
        subscriptionIds
      );

      return { url: portalSession.urls.general.overview };
    } catch (error) {
      console.error('Error creating portal session:', error);
      throw error;
    }
  }

  /**
   * Verify and process webhook
   */
  async processWebhook(rawBody: string, signature: string): Promise<void> {
    if (!paddle) {
      throw new Error('Paddle is not configured');
    }

    try {
      console.log('Raw body:', rawBody);
      console.log('Signature:', signature);
      console.log('PADDLE_WEBHOOK_SECRET:', PADDLE_WEBHOOK_SECRET);
      // Verify signature and unmarshal event
      const event = await paddle.webhooks.unmarshal(rawBody, PADDLE_WEBHOOK_SECRET, signature);

      console.log(`Processing Paddle webhook: ${event.eventType}`, event.eventId);

      switch (event.eventType) {
        case EventName.SubscriptionCreated:
        case EventName.SubscriptionUpdated:
        case EventName.SubscriptionActivated:
        case EventName.SubscriptionTrialing:
          await this.handleSubscriptionUpdate(event.data);
          break;

        case EventName.SubscriptionCanceled:
          await this.handleSubscriptionCanceled(event.data);
          break;

        case EventName.SubscriptionPaused:
          await this.handleSubscriptionPaused(event.data);
          break;

        case EventName.SubscriptionResumed:
          await this.handleSubscriptionResumed(event.data);
          break;

        case EventName.SubscriptionPastDue:
          await this.handleSubscriptionPastDue(event.data);
          break;

        case EventName.TransactionCompleted:
          console.log(`Transaction completed: ${event.data.id}`);
          break;

        case EventName.TransactionPaymentFailed:
          console.log(`Payment failed for transaction: ${event.data.id}`);
          break;

        case EventName.CustomerCreated:
        case EventName.CustomerUpdated:
          console.log(`Customer event: ${event.data.id}`);
          break;

        default:
          console.log(`Unhandled event type: ${event.eventType}`);
      }
    } catch (error) {
      console.error('Error processing webhook:', error);
      throw error;
    }
  }

  /**
   * Handle subscription creation/update
   * If user is in trial and bought a plan, save as pending plan
   */
  private async handleSubscriptionUpdate(data: any): Promise<void> {
    const customData = data.customData as { 
      firebaseUid?: string;
      startsAfterTrial?: boolean;
      billingStartsAt?: string;
      planId?: string;
      planName?: string;
      billingCycle?: string;
    } | null;
    const uid = customData?.firebaseUid;

    if (!uid) {
      console.warn('No firebaseUid found in subscription custom data');
      return;
    }

    const priceId = data.items?.[0]?.price?.id;
    const plan = priceId ? getPlanByPriceId(priceId) : null;

    // Check if this subscription should start after trial (pending plan)
    const isInTrial = await subscriptionsRepository.isInTrial(uid);
    const startsAfterTrial = customData?.startsAfterTrial === true;
    
    if (isInTrial && startsAfterTrial && customData?.billingStartsAt) {
      // User is in trial and purchased a plan - save as pending plan
      const billingStartsAt = new Date(customData.billingStartsAt);
      
      await subscriptionsRepository.setPendingPlan(uid, {
        planId: plan?.id || customData?.planId || 'basic',
        planName: plan?.name || customData?.planName || 'Plan',
        billingCycle: plan?.billingCycle || customData?.billingCycle || 'monthly',
        startsAt: billingStartsAt,
        paddleSubscriptionId: data.id,
        paddlePriceId: priceId || '',
      });
      
      console.log(`Pending plan saved for user ${uid}: ${plan?.name} starts at ${billingStartsAt.toISOString()}`);
      
      // Don't update the main subscription yet - keep the trial active
      return;
    }

    // If subscription is now active (not pending), clear any pending plan
    if (data.status === 'active') {
      await subscriptionsRepository.clearPendingPlan(uid);
    }

    const subscriptionData: UserSubscription = {
      paddleSubscriptionId: data.id,
      paddleCustomerId: data.customerId,
      paddlePriceId: priceId || null,
      planId: (plan?.id as any) || 'basic',
      billingCycle: (plan?.billingCycle as any) || 'monthly',
      status: data.status as SubscriptionStatus,
      currentPeriodStart: data.currentBillingPeriod?.startsAt 
        ? new Date(data.currentBillingPeriod.startsAt) 
        : null,
      currentPeriodEnd: data.currentBillingPeriod?.endsAt 
        ? new Date(data.currentBillingPeriod.endsAt) 
        : null,
      cancelAtPeriodEnd: data.scheduledChange?.action === 'cancel',
      trialEnd: data.currentBillingPeriod?.startsAt && data.status === 'trialing'
        ? new Date(data.currentBillingPeriod.endsAt)
        : null
    };

    await subscriptionsRepository.updateSubscription(uid, subscriptionData);
    console.log(`Updated subscription for user ${uid}:`, subscriptionData.status);
  }

  /**
   * Handle subscription canceled - disconnect WAHA session
   */
  private async handleSubscriptionCanceled(data: any): Promise<void> {
    const customData = data.customData as { firebaseUid?: string } | null;
    const uid = customData?.firebaseUid;

    if (!uid) {
      console.warn('No firebaseUid found in canceled subscription');
      return;
    }

    // Update subscription status
    await subscriptionsRepository.updateSubscriptionStatus(uid, 'canceled');

    // Disconnect WAHA session
    await this.disconnectWahaSession(uid);

    console.log(`Subscription canceled for user ${uid}, WAHA session disconnected`);
  }

  /**
   * Handle subscription paused
   */
  private async handleSubscriptionPaused(data: any): Promise<void> {
    const customData = data.customData as { firebaseUid?: string } | null;
    const uid = customData?.firebaseUid;

    if (!uid) return;

    await subscriptionsRepository.updateSubscriptionStatus(uid, 'paused');
    
    // Disconnect WAHA session when paused
    await this.disconnectWahaSession(uid);

    console.log(`Subscription paused for user ${uid}`);
  }

  /**
   * Handle subscription resumed
   */
  private async handleSubscriptionResumed(data: any): Promise<void> {
    const customData = data.customData as { firebaseUid?: string } | null;
    const uid = customData?.firebaseUid;

    if (!uid) return;

    await subscriptionsRepository.updateSubscriptionStatus(uid, 'active');
    console.log(`Subscription resumed for user ${uid}`);
  }

  /**
   * Handle subscription past due
   */
  private async handleSubscriptionPastDue(data: any): Promise<void> {
    const customData = data.customData as { firebaseUid?: string } | null;
    const uid = customData?.firebaseUid;

    if (!uid) return;

    await subscriptionsRepository.updateSubscriptionStatus(uid, 'past_due');
    console.log(`Subscription past due for user ${uid}`);
  }

  /**
   * Disconnect WAHA session for a user
   */
  private async disconnectWahaSession(uid: string): Promise<void> {
    try {
      // Get the user's WAHA session name
      const sessionName = await subscriptionsRepository.getWahaSessionName(uid) || `multimai_${uid}`;
      
      // Call WS Proxy API to stop/delete the session
      await wsProxyClient.post('/ws/session/stop', { session: sessionName });
      
      // Mark session as disconnected in Firestore
      await subscriptionsRepository.markWahaSessionDisconnected(uid);
      
      console.log(`WAHA session ${sessionName} disconnected for user ${uid}`);
    } catch (error) {
      console.error(`Error disconnecting WAHA session for ${uid}:`, error);
      // Don't throw - this shouldn't block the webhook processing
    }
  }

  /**
   * Get available plans
   */
  getPlans() {
    return Object.values(PADDLE_PLANS);
  }

  /**
   * Check if user has active subscription
   */
  async hasActiveSubscription(uid: string): Promise<boolean> {
    const subscription = await subscriptionsRepository.getSubscription(uid);
    
    if (!subscription) return false;
    
    return ['active', 'trialing'].includes(subscription.status);
  }

  /**
   * Check if trial has expired
   */
  async isTrialExpired(uid: string): Promise<boolean> {
    const subscription = await subscriptionsRepository.getSubscription(uid);
    
    if (!subscription) return false;
    
    // Check if it's a free trial that has expired
    if (subscription.planId === 'free_trial' && subscription.currentPeriodEnd) {
      return new Date() > subscription.currentPeriodEnd;
    }
    
    return subscription.status === 'expired' || subscription.status === 'canceled';
  }
}

export const paddleService = new PaddleService();

