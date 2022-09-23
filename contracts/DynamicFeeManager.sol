// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BaseDynamicFeeManager.sol";
import "./interfaces/IFeeReceiver.sol";

/**
 * @title Dynamic Fee Manager for ERC20 token
 *
 * The dynamic fee manager allows to dynamically add fee rules to ERC20 token transactions.
 * Fees will be applied if the given conditions are met.
 * Additonally, fees can be used to create liquidity on DEX or can be swapped to BUSD.
 */
contract DynamicFeeManager is BaseDynamicFeeManager {
    using SafeMath for uint256;

    constructor() BaseDynamicFeeManager() {}

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
    ) public override onlyRole(ADMIN) returns (uint256 index) {
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

    function removeFee(uint256 index) public override onlyRole(ADMIN) {
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
        address token,
        address from,
        address to,
        uint256 amount
    ) public override nonReentrant returns (uint256 tTotal, uint256 tFees) {
        bool bypassFees = !feesEnabled() ||
            from == owner() ||
            hasRole(ADMIN, from) ||
            hasRole(FEE_WHITELIST, from) ||
            hasRole(RECEIVER_FEE_WHITELIST, to);

        if (bypassFees) {
            return (amount, 0);
        }

        bool bypassSwapAndLiquify = hasRole(ADMIN, from) ||
            hasRole(BYPASS_SWAP_AND_LIQUIFY, from);

        // Loop over all fee entries and calculate plus reflect fee
        for (uint256 i = 0; i < _fees.length; i++) {
            FeeEntry memory fee = _fees[i];

            if (_isFeeEntryValid(fee) && _isFeeEntryMatching(fee, from, to)) {
                uint256 tFee = _calculateFee(amount, fee);
                tFees = tFees.add(tFee);
                _reflectFee(token, from, to, tFee, fee, bypassSwapAndLiquify);
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
     * @param token address - Address of the ERC20 token used
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param tFee uint256 - Fee amount
     * @param fee FeeEntry - Fee Entry
     */
    function _reflectFee(
        address token,
        address from,
        address to,
        uint256 tFee,
        FeeEntry memory fee,
        bool bypassSwapAndLiquify
    ) private {
        // Transfer fee or add to liquify / swap amount
        if (!fee.doLiquify && !fee.doSwapForBusd) {
            require(
                IWeSenditToken(token).transferFromNoFees(
                    from,
                    fee.destination,
                    tFee
                ),
                "DynamicFeeManager: Fee transfer to destination failed"
            );
        } else {
            require(
                IWeSenditToken(token).transferFromNoFees(
                    from,
                    address(this),
                    tFee
                ),
                "DynamicFeeManager: Fee transfer to manager failed"
            );
            _amounts[fee.id] = _amounts[fee.id].add(tFee);
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
                token,
                from,
                to,
                tFee
            );
        }

        emit FeeReflected(
            fee.id,
            token,
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
     * Swaps half of the token amount and add liquidity on Pancakeswap
     *
     * @param token address - Token to use
     * @param amount uint256 - Amount to use
     * @param destination address - Destination address for the LP tokens
     */
    function _swapAndLiquify(
        address token,
        uint256 amount,
        address destination
    ) private {
        // split the contract balance into halves
        uint256 half = amount.div(2);
        uint256 otherHalf = amount.sub(half);

        // capture the contract's current BNB balance.
        // this is so that we can capture exactly the amount of BNB that the
        // swap creates, and not make the liquidity event include any BNB that
        // has been manually sent to the contract
        uint256 initialBalance = address(this).balance;

        // swap tokens for BNB
        _swapTokensForBnb(token, half, destination); // <- this breaks the BNB -> WSI swap when swap+liquify is triggered

        // how much BNB did we just swap into?
        uint256 newBalance = address(this).balance.sub(initialBalance);

        // add liquidity to uniswap
        _addLiquidity(token, otherHalf, newBalance, destination);

        emit SwapAndLiquify(half, newBalance, otherHalf);
    }

    /**
     * Swaps tokens against BNB on Pancakeswap
     *
     * @param token address - Token to swap
     * @param amount uint256 - Amount to use
     * @param destination address - Destination address for BNB
     */
    function _swapTokensForBnb(
        address token,
        uint256 amount,
        address destination
    ) private {
        // generate the uniswap pair path of token -> wbnb
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = pancakeRouter().WETH();

        require(
            IERC20(token).approve(address(pancakeRouter()), amount),
            "DynamicFeeManager: Failed to approve token for swap BNB"
        );

        // make the swap
        pancakeRouter().swapExactTokensForETHSupportingFeeOnTransferTokens(
            amount,
            0, // accept any amount of BNB
            path,
            destination,
            block.timestamp
        );
    }

    /**
     * Swaps tokens against BUSD on Pancakeswap
     *
     * @param token address - Token to swap
     * @param amount uint256 - Amount to use
     * @param destination address - Destination address for BUSD
     */
    function _swapTokensForBusd(
        address token,
        uint256 amount,
        address destination
    ) private {
        // generate the uniswap pair path of token -> wbnb
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = busdAddress();

        require(
            IERC20(token).approve(address(pancakeRouter()), amount),
            "DynamicFeeManager: Failed to approve token for swap to BUSD"
        );

        // capture the contract's current BUSD balance.
        uint256 initialBalance = IERC20(token).balanceOf(destination);

        // make the swap
        pancakeRouter().swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount,
            0, // accept any amount of BUSD
            path,
            destination,
            block.timestamp
        );

        // how much BUSD did we just swap into?
        uint256 newBalance = IERC20(token).balanceOf(destination).sub(
            initialBalance
        );

        emit SwapTokenForBusd(token, amount, newBalance, destination);
    }

    /**
     * Creates liquidity on Pancakeswap
     *
     * @param token address - Token to use
     * @param tokenAmount uint256 - Amount of token to use
     * @param bnbAmount uint256 - Amount of BNB to use
     * @param destination address - Destination address for the LP tokens
     */
    function _addLiquidity(
        address token,
        uint256 tokenAmount,
        uint256 bnbAmount,
        address destination
    ) private {
        // approve token transfer to cover all possible scenarios
        require(
            IERC20(token).approve(address(pancakeRouter()), tokenAmount),
            "DynamicFeeManager: Failed to approve token for adding liquidity"
        );

        // add the liquidity
        pancakeRouter().addLiquidityETH{value: bnbAmount}(
            token,
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            destination,
            block.timestamp
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
     * @param from address - Sender Address
     * @param to address - Receiver address
     *
     * @return matching bool - Indicates, if the fee entry and from / to are matching
     */
    function _isFeeEntryMatching(
        FeeEntry memory fee,
        address from,
        address to
    ) private pure returns (bool matching) {
        return
            (fee.from == WHITELIST_ADDRESS && fee.to == WHITELIST_ADDRESS) ||
            (fee.from == from && fee.to == WHITELIST_ADDRESS) ||
            (fee.to == to && fee.from == WHITELIST_ADDRESS);
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
