# Mobile checkout viewport fix

The game shell uses the stable mobile viewport unit (`svh`) rather than the dynamic viewport unit (`dvh`). This prevents the underlying game from visibly shrinking when Razorpay Checkout changes Safari's visual viewport while its payment sheet is open.
