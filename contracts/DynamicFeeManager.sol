// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BaseDynamicFeeManager.sol";
import "./interfaces/IFeeReceiver.sol";
import "./interfaces/IWeSenditToken.sol";

/**
 * @title Dynamic Fee Manager for ERC20 token
 *
 * The dynamic fee manager allows to dynamically add fee rules to ERC20 token transactions.
 * Fees will be applied if the given conditions are met.
 * Additonally, fees can be used to create liquidity on DEX or can be swapped to BUSD.
 */
contract DynamicFeeManager is BaseDynamicFeeManager {
    using SafeMath for uint256;

    constructor(address wesenditToken) BaseDynamicFeeManager(wesenditToken) {}

    receive() external payable {}

    function addFee(
        address from,
        address to,
        uint256 percentage,
        address destination,
        bool doCallback,
        bool doLiquify,
        bool doSwapForBusd,
        uint256 swapOrLiquifyAmount,
        uint256 expiresAt
    ) external override onlyRole(ADMIN) returns (uint256 index) {
        require(
            percentage <= FEE_DIVIDER,
            "DynamicFeeManager: Invalid fee percentage"
        );
        require(
            percentage <= FEE_PERCENTAGE_LIMIT,
            "DynamicFeeManager: Fee percentage exceeds limit"
        );
        require(
            !(doLiquify && doSwapForBusd),
            "DynamicFeeManager: Cannot enable liquify and swap at the same time"
        );

        bytes32 id = _generateIdentifier(
            destination,
            doLiquify,
            doSwapForBusd,
            swapOrLiquifyAmount
        );

        FeeEntry memory feeEntry = FeeEntry(
            id,
            from,
            to,
            percentage,
            destination,
            doCallback,
            doLiquify,
            doSwapForBusd,
            swapOrLiquifyAmount,
            expiresAt
        );

        _fees.push(feeEntry);

        emit FeeAdded(
            id,
            from,
            to,
            percentage,
            destination,
            doCallback,
            doLiquify,
            doSwapForBusd,
            swapOrLiquifyAmount,
            expiresAt
        );

        // Return entry index
        return _fees.length - 1;
    }

    function removeFee(uint256 index) external override onlyRole(ADMIN) {
        require(index < _fees.length, "DynamicFeeManager: array out of bounds");

        // Reset current amount for liquify or swap
        bytes32 id = _fees[index].id;
        _amounts[id] = 0;

        // Remove fee entry from array
        _fees[index] = _fees[_fees.length - 1];
        _fees.pop();

        emit FeeRemoved(id, index);
    }

    function reflectFees(
        address from,
        address to,
        uint256 amount
    ) external override returns (uint256 tTotal, uint256 tFees) {
        bool bypassFees = !feesEnabled() ||
            from == owner() ||
            hasRole(ADMIN, from) ||
            hasRole(FEE_WHITELIST, from) ||
            hasRole(RECEIVER_FEE_WHITELIST, to);

        if (bypassFees) {
            return (amount, 0);
        }

        bool bypassSwapAndLiquify = hasRole(ADMIN, to) ||
            hasRole(ADMIN, from) ||
            hasRole(BYPASS_SWAP_AND_LIQUIFY, to) ||
            hasRole(BYPASS_SWAP_AND_LIQUIFY, from);

        // Loop over all fee entries and calculate plus reflect fee
        for (uint256 i = 0; i < _fees.length; i++) {
            FeeEntry memory fee = _fees[i];

            if (_isFeeEntryValid(fee) && _isFeeEntryMatching(fee, from, to)) {
                uint256 tFee = _calculateFee(amount, fee);
                tFees = tFees.add(tFee);
                _reflectFee(from, to, tFee, fee, bypassSwapAndLiquify);
            }
        }

        require(
            tFees <= amount.mul(TRANSACTION_FEE_LIMIT).div(100),
            "DynamicFeeManager: Transaction fees exceeding limit"
        );

        tTotal = amount.sub(tFees);
        _validateFeeAmount(amount, tTotal, tFees);

        return (tTotal, tFees);
    }

    /**
     * Reflects a single fee
     *
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param tFee uint256 - Fee amount
     * @param fee FeeEntry - Fee Entry
     */
    function _reflectFee(
        address from,
        address to,
        uint256 tFee,
        FeeEntry memory fee,
        bool bypassSwapAndLiquify
    ) private {
        // add to liquify / swap amount or transfer to fee destination
        if (fee.doLiquify || fee.doSwapForBusd) {
            require(
                IWeSenditToken(address(token())).transferFromNoFees(
                    from,
                    address(this),
                    tFee
                ),
                "DynamicFeeManager: Fee transfer to manager failed"
            );
            _amounts[fee.id] = _amounts[fee.id].add(tFee);
        } else {
            require(
                IWeSenditToken(address(token())).transferFromNoFees(
                    from,
                    fee.destination,
                    tFee
                ),
                "DynamicFeeManager: Fee transfer to destination failed"
            );
        }

        // Check if swap / liquify amount was reached
        if (
            !bypassSwapAndLiquify && _amounts[fee.id] >= fee.swapOrLiquifyAmount
        ) {
            if (fee.doSwapForBusd) {
                // swap token for BUSD
                _swapTokensForBusd(
                    token,
                    fee.swapOrLiquifyAmount,
                    fee.destination
                );
            } else if (fee.doLiquify) {
                // swap and liquify token
                _swapAndLiquify(
                    token,
                    fee.swapOrLiquifyAmount,
                    fee.destination
                );
            }

            _amounts[fee.id] = _amounts[fee.id].sub(fee.swapOrLiquifyAmount);
        }

        // Check if callback should be called on destination
        if (fee.doCallback && !fee.doSwapForBusd && !fee.doLiquify) {
            IFeeReceiver(fee.destination).onERC20Received(
                address(this),
                address(token()),
                from,
                to,
                tFee
            );
        }

        emit FeeReflected(
            fee.id,
            address(token()),
            from,
            to,
            tFee,
            fee.destination,
            fee.doCallback,
            fee.doLiquify,
            fee.doSwapForBusd,
            fee.swapOrLiquifyAmount,
            fee.expiresAt
        );
    }

    /**
     * Checks if the fee entry is still valid
     *
     * @param fee FeeEntry - Fee Entry
     *
     * @return isValid bool - Indicates, if the fee entry is still valid
     */
    function _isFeeEntryValid(FeeEntry memory fee)
        private
        view
        returns (bool isValid)
    {
        return fee.expiresAt == 0 || block.timestamp <= fee.expiresAt;
    }

    /**
     * Checks if the fee entry matches
     *
     * @param fee FeeEntry - Fee Entry
     * @param from address - Sender address
     * @param to address - Receiver address
     *
     * @return matching bool - Indicates, if the fee entry and from / to are matching
     */
    function _isFeeEntryMatching(
        FeeEntry memory fee,
        address from,
        address to
    ) private view returns (bool matching) {
        return
            (fee.from == WHITELIST_ADDRESS &&
                fee.to == WHITELIST_ADDRESS &&
                !hasRole(EXCLUDE_WILDCARD_FEE, from) &&
                !hasRole(EXCLUDE_WILDCARD_FEE, to)) ||
            (fee.from == from &&
                fee.to == WHITELIST_ADDRESS &&
                !hasRole(EXCLUDE_WILDCARD_FEE, to)) ||
            (fee.to == to &&
                fee.from == WHITELIST_ADDRESS &&
                !hasRole(EXCLUDE_WILDCARD_FEE, from)) ||
            (fee.to == to && fee.from == from);
    }

    /**
     * Validates the new total amount and fee amount
     *
     * @param amount uint256 - Original transaction amount
     * @param tTotal uint256 - Transaction amount after fees
     * @param tFees uint256 - Fee amount
     */
    function _validateFeeAmount(
        uint256 amount,
        uint256 tTotal,
        uint256 tFees
    ) private pure {
        require(tTotal > 0, "DynamicFeeManager: invalid total amount");
        require(
            tTotal.add(tFees) == amount,
            "DynamicFeeManager: invalid transfer amount"
        );
    }

    /**
     * Calculates a single fee
     *
     * @param amount uint256 - Transaction amount
     * @param fee FeeEntry - Fee Entry
     *
     * @return tFee - Total Fee Amount
     */
    function _calculateFee(uint256 amount, FeeEntry memory fee)
        private
        pure
        returns (uint256 tFee)
    {
        return amount.mul(fee.percentage).div(FEE_DIVIDER); // ex. 125/100000 = 0.000125 = 0.0125%
    }

    /**
     * Generates an unique identifier for a fee entry
     *
     * @param destination address - Destination address for the fee
     * @param doLiquify bool - Indicates, if the fee amount should be used to add liquidy on DEX
     * @param doSwapForBusd bool - Indicates, if the fee amount should be swapped to BUSD
     * @param swapOrLiquifyAmount uint256 - Amount for liquidify or swap
     *
     * @return id bytes32 - Unique id
     */
    function _generateIdentifier(
        address destination,
        bool doLiquify,
        bool doSwapForBusd,
        uint256 swapOrLiquifyAmount
    ) private pure returns (bytes32 id) {
        return
            keccak256(
                abi.encodePacked(
                    destination,
                    doLiquify,
                    doSwapForBusd,
                    swapOrLiquifyAmount
                )
            );
    }
}
