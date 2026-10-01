using System.Web.Services;

namespace OrdersPortal.Services
{
    // Placeholder: an old SOAP endpoint kept for one partner system.
    [WebService(Namespace = "urn:example:orders")]
    public class LegacyOrders : WebService
    {
        [WebMethod]
        public string Ping() => "ok";
    }
}
