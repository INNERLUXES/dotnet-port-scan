using System.ServiceModel;

namespace OrdersPortal.Services
{
    [ServiceContract]
    public interface IOrderService
    {
        [OperationContract]
        string GetStatus(int orderId);
    }
}
