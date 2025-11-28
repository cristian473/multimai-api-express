import { db } from '../firebase';
import { userDocument } from '../constants';
import type { UserSubscription, SubscriptionStatus } from '../../../entities/paddle/paddle.dto';
import { FieldValue } from 'firebase-admin/firestore';

class SubscriptionsRepository {
  /**
   * Get subscription for a user
   */
  async getSubscription(uid: string): Promise<UserSubscription | null> {
    try {
      const snapshot = await db.doc(userDocument(uid)).get();
      
      if (!snapshot.exists) {
        return null;
      }

      const userData = snapshot.data();
      const subscription = userData?.subscription;
      const paddleCustomerId = userData?.paddleCustomerId || null;

      if (!subscription) {
        return null;
      }

      // Convert Firestore timestamps to Date objects
      return {
        paddleSubscriptionId: subscription.paddleSubscriptionId || null,
        paddleCustomerId: paddleCustomerId,
        paddlePriceId: subscription.paddlePriceId || null,
        planId: subscription.planId || 'free_trial',
        billingCycle: subscription.billingCycle || null,
        status: subscription.status || 'free_trial',
        currentPeriodStart: subscription.currentPeriodStart?.toDate() || null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toDate() || 
                         subscription.endDate?.toDate() || null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
        trialEnd: subscription.trialEnd?.toDate() || 
                  subscription.endDate?.toDate() || null,
      };
    } catch (error) {
      console.error('Error getting subscription:', error);
      return null;
    }
  }

  /**
   * Update subscription for a user
   */
  async updateSubscription(uid: string, data: UserSubscription): Promise<void> {
    try {
      const userRef = db.doc(userDocument(uid));
      
      await userRef.update({
        paddleCustomerId: data.paddleCustomerId,
        subscription: {
          paddleSubscriptionId: data.paddleSubscriptionId,
          paddlePriceId: data.paddlePriceId,
          planId: data.planId,
          billingCycle: data.billingCycle,
          status: data.status,
          currentPeriodStart: data.currentPeriodStart,
          currentPeriodEnd: data.currentPeriodEnd,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
          trialEnd: data.trialEnd,
          updatedAt: FieldValue.serverTimestamp(),
        }
      });
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw error;
    }
  }

  /**
   * Update only the subscription status
   */
  async updateSubscriptionStatus(uid: string, status: SubscriptionStatus): Promise<void> {
    try {
      const userRef = db.doc(userDocument(uid));
      
      await userRef.update({
        'subscription.status': status,
        'subscription.updatedAt': FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating subscription status:', error);
      throw error;
    }
  }

  /**
   * Get Paddle customer ID for a user
   */
  async getPaddleCustomerId(uid: string): Promise<string | null> {
    try {
      const snapshot = await db.doc(userDocument(uid)).get();
      
      if (!snapshot.exists) {
        return null;
      }

      return snapshot.data()?.paddleCustomerId || null;
    } catch (error) {
      console.error('Error getting Paddle customer ID:', error);
      return null;
    }
  }

  /**
   * Update Paddle customer ID for a user
   */
  async updatePaddleCustomerId(uid: string, customerId: string): Promise<void> {
    try {
      const userRef = db.doc(userDocument(uid));
      
      await userRef.update({
        paddleCustomerId: customerId,
      });
    } catch (error) {
      console.error('Error updating Paddle customer ID:', error);
      throw error;
    }
  }

  /**
   * Check if user has active subscription
   */
  async hasActiveSubscription(uid: string): Promise<boolean> {
    const subscription = await this.getSubscription(uid);
    
    if (!subscription) return false;
    
    // Check status
    if (['active', 'trialing'].includes(subscription.status)) {
      // Also check if period hasn't ended
      if (subscription.currentPeriodEnd) {
        return new Date() < subscription.currentPeriodEnd;
      }
      return true;
    }
    
    return false;
  }

  /**
   * Check if trial has expired
   */
  async isTrialExpired(uid: string): Promise<boolean> {
    const subscription = await this.getSubscription(uid);
    
    if (!subscription) return false;
    
    // Check if it's a free trial that has expired
    if (subscription.planId === 'free_trial' || subscription.status === 'free_trial') {
      if (subscription.currentPeriodEnd) {
        return new Date() > subscription.currentPeriodEnd;
      }
      if (subscription.trialEnd) {
        return new Date() > subscription.trialEnd;
      }
    }
    
    return subscription.status === 'expired' || subscription.status === 'canceled';
  }

  /**
   * Get user's WAHA session name
   */
  async getWahaSessionName(uid: string): Promise<string | null> {
    try {
      const snapshot = await db.doc(userDocument(uid)).get();
      
      if (!snapshot.exists) {
        return null;
      }

      const userData = snapshot.data();
      // Session name is typically stored in agent config or user document
      return userData?.wahaSession || `multimai_${uid}`;
    } catch (error) {
      console.error('Error getting WAHA session name:', error);
      return null;
    }
  }

  /**
   * Mark WAHA session as disconnected
   */
  async markWahaSessionDisconnected(uid: string): Promise<void> {
    try {
      const userRef = db.doc(userDocument(uid));
      
      await userRef.update({
        wahaSessionStatus: 'disconnected',
        wahaDisconnectedAt: FieldValue.serverTimestamp(),
        wahaDisconnectReason: 'subscription_expired',
      });
    } catch (error) {
      console.error('Error marking WAHA session as disconnected:', error);
      throw error;
    }
  }

  /**
   * Get trial end date for a user
   */
  async getTrialEndDate(uid: string): Promise<Date | null> {
    try {
      const snapshot = await db.doc(userDocument(uid)).get();
      
      if (!snapshot.exists) {
        return null;
      }

      const userData = snapshot.data();
      const subscription = userData?.subscription;
      
      // Trial end date can be in trialEnd or endDate (legacy)
      const trialEnd = subscription?.trialEnd?.toDate() || 
                       subscription?.endDate?.toDate() || null;
      
      return trialEnd;
    } catch (error) {
      console.error('Error getting trial end date:', error);
      return null;
    }
  }

  /**
   * Check if user is currently in trial
   */
  async isInTrial(uid: string): Promise<boolean> {
    try {
      const subscription = await this.getSubscription(uid);
      
      if (!subscription) return false;
      
      const isTrialPlan = subscription.planId === 'free_trial' || 
                          subscription.status === 'free_trial' ||
                          subscription.status === 'trialing';
      
      if (!isTrialPlan) return false;
      
      // Check if trial hasn't expired yet
      const endDate = subscription.currentPeriodEnd || subscription.trialEnd;
      if (endDate && new Date() < endDate) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking trial status:', error);
      return false;
    }
  }

  /**
   * Set pending plan for a user (plan purchased during trial)
   */
  async setPendingPlan(uid: string, pendingPlan: {
    planId: string;
    planName: string;
    billingCycle: string;
    startsAt: Date;
    paddleSubscriptionId: string;
    paddlePriceId: string;
  }): Promise<void> {
    try {
      const userRef = db.doc(userDocument(uid));
      
      await userRef.update({
        'subscription.pendingPlan': {
          planId: pendingPlan.planId,
          planName: pendingPlan.planName,
          billingCycle: pendingPlan.billingCycle,
          startsAt: pendingPlan.startsAt,
          paddleSubscriptionId: pendingPlan.paddleSubscriptionId,
          paddlePriceId: pendingPlan.paddlePriceId,
          createdAt: FieldValue.serverTimestamp(),
        }
      });
      
      console.log(`Pending plan set for user ${uid}: ${pendingPlan.planName} starts at ${pendingPlan.startsAt}`);
    } catch (error) {
      console.error('Error setting pending plan:', error);
      throw error;
    }
  }

  /**
   * Clear pending plan (when plan activates)
   */
  async clearPendingPlan(uid: string): Promise<void> {
    try {
      const userRef = db.doc(userDocument(uid));
      
      await userRef.update({
        'subscription.pendingPlan': FieldValue.delete(),
      });
      
      console.log(`Pending plan cleared for user ${uid}`);
    } catch (error) {
      console.error('Error clearing pending plan:', error);
      throw error;
    }
  }

  /**
   * Get pending plan for a user
   */
  async getPendingPlan(uid: string): Promise<any | null> {
    try {
      const snapshot = await db.doc(userDocument(uid)).get();
      
      if (!snapshot.exists) {
        return null;
      }

      const userData = snapshot.data();
      const pendingPlan = userData?.subscription?.pendingPlan;
      
      if (!pendingPlan) return null;
      
      return {
        ...pendingPlan,
        startsAt: pendingPlan.startsAt?.toDate() || null,
      };
    } catch (error) {
      console.error('Error getting pending plan:', error);
      return null;
    }
  }
}

export const subscriptionsRepository = new SubscriptionsRepository();

