// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IPancakeRouter.sol";

/**
 * Fee entry structure
 */
struct FeeEntry {
    // Unique identifier for the fee entry
    // Generated out of (destination, doLiquify, doSwapForBusd, swapOrLiquifyAmount) to
    // always use the same _amounts entry.
    bytes32 id;
    // Sender address OR wildcard address
    address from;
    // Receiver address OR wildcard address
    address to;
    // Fee percentage multiplied by 100000
    uint256 percentage;
    // Fee destination address
    address destination;
    // Indicator, if callback should be called on the destination address
    bool doCallback;
    // Indicator, if the fee amount should be used to add liquidation on DEX
    bool doLiquify;
    // Indicator, if the fee amount should be swapped to BUSD
    bool doSwapForBusd;
    // Amount used to add liquidation OR swap to BUSD
    uint256 swapOrLiquifyAmount;
}

interface IDynamicFeeManager {
    /**
     * Emitted on fee addition
     *
     * @param id bytes32 - "Unique" identifier for fee entry
     * @param from address - Sender address OR address(0) for wildcard
     * @param to address - Receiver address OR address(0) for wildcard
     * @param percentage uint256 - Fee percentage to take multiplied by 100000
     * @param destination address - Destination address for the fee
     * @param doCallback bool - Indicates, if a callback should be called at the fee destination
     * @param doLiquify bool - Indicates, if the fee amount should be used to add liquidy on DEX
     * @param doSwapForBusd bool - Indicates, if the fee amount should be swapped to BUSD
     * @param swapOrLiquifyAmount uint256 - Amount for liquidify or swap
     */
    event FeeAdded(
        bytes32 id,
        address from,
        address to,
        uint256 percentage,
        address destination,
        bool doCallback,
        bool doLiquify,
        bool doSwapForBusd,
        uint256 swapOrLiquifyAmount
    );

    /**
     * Emitted on fee removal
     *
     * @param id bytes32 - "Unique" identifier for fee entry
     * @param index uint256 - Index of removed the fee
     */
    event FeeRemoved(bytes32 id, uint256 index);

    /**
     * Emitted on fee reflection / distribution
     *
     * @param id bytes32 - "Unique" identifier for fee entry
     * @param token address - Token used for fee
     * @param from address - Sender address OR address(0) for wildcard
     * @param to address - Receiver address OR address(0) for wildcard
     * @param destination address - Destination address for the fee
     * @param doCallback bool - Indicates, if a callback should be called at the fee destination
     * @param doLiquify bool - Indicates, if the fee amount should be used to add liquidy on DEX
     * @param doSwapForBusd bool - Indicates, if the fee amount should be swapped to BUSD
     * @param swapOrLiquifyAmount uint256 - Amount for liquidify or swap
     */
    event FeeReflected(
        bytes32 id,
        address token,
        address from,
        address to,
        uint256 tFee,
        address destination,
        bool doCallback,
        bool doLiquify,
        bool doSwapForBusd,
        uint256 swapOrLiquifyAmount
    );

    /**
     * Emitted on pancake router address update
     *
     * @param newAddress address - New pancake router address
     */
    event PancakeRouterUpdated(address newAddress);

    /**
     * Emitted on BUSD address update
     *
     * @param newAddress address - New BUSD address
     */
    event BusdAddressUpdated(address newAddress);

    /**
     * Emitted on swap and liquify event
     *
     * @param firstHalf uint256 - Half of tokens
     * @param newBalance uint256 - Amount of BNB
     * @param secondHalf uint256 - Half of tokens for BNB swap
     */
    event SwapAndLiquify(
        uint256 firstHalf,
        uint256 newBalance,
        uint256 secondHalf
    );

    /**
     * Emitted on token swap to BUSD
     *
     * @param token address - Token used for swap
     * @param inputAmount uint256 - Amount used as input for swap
     * @param newBalance uint256 - Amount of received BUSD
     * @param destination address - Destination address for BUSD
     */
    event SwapTokenForBusd(
        address token,
        uint256 inputAmount,
        uint256 newBalance,
        address destination
    );

    /**
     * Return the fee entry at the given index
     *
     * @param index uint256 - Index of the fee entry
     *
     * @return fee FeeEntry - Fee entry
     */
    function getFee(uint256 index) external view returns (FeeEntry memory fee);

    /**
     * Adds a fee entry to the list of fees
     *
     * @param from address - Sender address OR address(0) for wildcard
     * @param to address - Receiver address OR address(0) for wildcard
     * @param percentage uint256 - Fee percentage to take multiplied by 100000
     * @param destination address - Destination address for the fee
     * @param doCallback bool - Indicates, if a callback should be called at the fee destination
     * @param doLiquify bool - Indicates, if the fee amount should be used to add liquidy on DEX
     * @param doSwapForBusd bool - Indicates, if the fee amount should be swapped to BUSD
     * @param swapOrLiquifyAmount uint256 - Amount for liquidify or swap
     *
     * @return index uint256 - Index of the newly added fee entry
     */
    function addFee(
        address from,
        address to,
        uint256 percentage,
        address destination,
        bool doCallback,
        bool doLiquify,
        bool doSwapForBusd,
        uint256 swapOrLiquifyAmount
    ) external returns (uint256 index);

    /**
     * Removes the fee entry at the given index
     *
     * @param index uint256 - Index to remove
     */
    function removeFee(uint256 index) external;

    /**
     * Calculates the fee for a transaction
     *
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uint256 - Transaction amount
     *
     * @return tTotal uint256 - Total transaction amount after fees
     * @return tFees uint256 - Total fee amount
     */
    function calculateFees(
        address from,
        address to,
        uint256 amount
    ) external view returns (uint256 tTotal, uint256 tFees);

    /**
     * Reflects the fee for a transaction
     *
     * @param token address - Address of the ERC20 token used
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uint256 - Transaction amount
     *
     * @return tTotal uint256 - Total transaction amount after fees
     * @return tFees uint256 - Total fee amount
     */
    function reflectFees(
        address token,
        address from,
        address to,
        uint256 amount,
        bool bypassSwapAndLiquify
    ) external returns (uint256 tTotal, uint256 tFees);

    /**
     * Returns the collected amount for swap / liquify fees
     *
     * @param id bytes32 - Fee entry id
     *
     * @return amount uint256 - Collected amount
     */
    function getFeeAmount(bytes32 id) external view returns (uint256 amount);

    /**
     * Returns the pancake router
     *
     * @return value IPancakeRouter02 - Pancake router
     */
    function pancakeRouter() external view returns (IPancakeRouter02 value);

    /**
     * Sets the pancake router
     *
     * @param value address - New pancake router address
     */
    function setPancakeRouter(address value) external;

    /**
     * Returns the BUSD address
     *
     * @return value address - BUSD address
     */
    function busdAddress() external view returns (address value);

    /**
     * Sets the BUSD address
     *
     * @param value address - BUSD address
     */
    function setBusdAddress(address value) external;
}
