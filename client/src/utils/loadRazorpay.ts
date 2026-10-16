const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loading: Promise<boolean> | null = null;

/**
 * Loads Razorpay Checkout on demand (only on the billing page, never in
 * index.html). Resolves false if the script can't be fetched, so the caller can
 * show an error instead of failing silently.
 */
export function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  loading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      script.remove();
      loading = null; // allow a retry, e.g. after the connection comes back
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return loading;
}
