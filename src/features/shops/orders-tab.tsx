import { PayloadTester } from '@/features/integrations/payload-tester'
import { functionsBaseUrl } from '@/features/integrations/queries'

/** How this shop sends orders, and a place to check a payload before sending it. */
export function OrdersTab() {
  return (
    <div className="space-y-8">
      <section aria-labelledby="orders-send-title" className="max-w-3xl">
        <h2 id="orders-send-title" className="font-display text-lg font-semibold tracking-[-0.01em]">Sending orders</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The shop sends one event for every order change, with its secret key and its store id. Orders create their customers, move the stock
          estimate and start automations. Nothing is set up here: the shop only needs the address and the key.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-mono text-foreground [overflow-wrap:anywhere]">POST {functionsBaseUrl()}/order-webhook</span> with{' '}
          <span className="font-mono text-foreground">Authorization: Bearer &lt;key&gt;</span> and <span className="font-mono text-foreground">X-Store-Id</span>.
        </p>
      </section>
      <section aria-labelledby="orders-test-title" className="max-w-3xl border-t pt-6">
        <h2 id="orders-test-title" className="font-display text-lg font-semibold tracking-[-0.01em]">Check an order payload</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">Validates a sample against the same rules the receiving function uses. Nothing is sent.</p>
        <PayloadTester />
      </section>
    </div>
  )
}
