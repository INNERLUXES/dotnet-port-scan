namespace OrdersPortal.Core
{
    // Placeholder business rules.
    public static class OrderRules
    {
        public static bool CanCancel(string status) => status == "open";
    }
}
