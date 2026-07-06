import { findUserByRequest, isSubscriptionActive } from './store.js';

export async function requireSubscription(request, response, next) {
  const user = await findUserByRequest(request);

  if (!isSubscriptionActive(user)) {
    return response.status(403).json({
      error: 'subscription_required',
      active: false,
      message: 'Нужна активная подписка Maniya Online'
    });
  }

  request.maniyaUser = user;
  next();
}
