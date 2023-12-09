// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

struct Payment {
    // Unique identifier for the payment
    // Generated out of (user, timestamp, amount)
    bytes32 id;
    // User address
    address user;
    // Payment amount
    uint256 amount;
    // Time when payment was executed
    uint256 executedAt;
    // Indicated if the payment was refunded
    bool isRefunded;
    // Time when payment was refunded (if not refunded, defaults to zero)
    uint256 refundedAt;
}

interface IPaymentProcessor {
    /**
     * Emitted when a payment was done by an user
     *
     * @param paymentId bytes32 - Unique id of the payment
     * @param user address - User address
     * @param amount uint256 - Added token amount
     */
    event PaymentDone(
        bytes32 indexed paymentId,
        address indexed user,
        uint256 amount
    );

    /**
     * Emitted when a payment was refunded to an user
     *
     * @param paymentId bytes32 - Unique id of the payment
     * @param user address - User address
     * @param amount uint256 - Added token amount
     */
    event PaymentRefunded(
        bytes32 indexed paymentId,
        address indexed user,
        uint256 amount
    );

    /**
     * Returns details about the last payment of an user
     *
     * @param user address - User address
     *
     * @return payment Payment - Last payment object
     */
    function lastPayment(
        address user
    ) external view returns (Payment memory payment);

    /**
     * Returns all payments of a given user
     *
     * @param user address - User address
     *
     * @return payments Payment[] - List of payment object
     */
    function paymentsByUser(
        address user
    ) external view returns (Payment[] memory payments);

    /**
     * Returns a payment of a given user at given index
     *
     * @param user address - User address
     * @param index uint256 - Index of payment
     *
     * @return payment Payment - Payment object
     */
    function paymentAtIndex(
        address user,
        uint256 index
    ) external view returns (Payment memory payment);

    /**
     * Returns a payment by a given id
     *
     * @param paymentId Unique payment id
     *
     * @return payment Payment - Payment object
     */
    function paymentById(
        bytes32 paymentId
    ) external view returns (Payment memory payment);

    /**
     * Returns the count of payment done by an user
     *
     * @param user address - User address
     *
     * @return count uint256 - Count of payments
     */
    function paymentCount(address user) external view returns (uint256 count);

    /**
     * Executes a payment from for the given user
     * (can only be called with EXECUTE_PAYMENT role)
     *
     * @param user address - User address
     * @param amount uint256 - Payment token amount
     */
    function executePayment(address user, uint256 amount) external;

    /**
     * Refunds a payment of the given user
     * (can only be called with REFUND_PAYMENT role)
     *
     * @param paymentId bytes32 - Unique payment id
     */
    function refundPayment(bytes32 paymentId) external;
}
