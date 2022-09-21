// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

import "./BaseWeSenditToken.sol";

contract WeSenditToken is BaseWeSenditToken, ERC20Capped, ERC20Burnable {
    using SafeMath for uint256;

    constructor(address addressTotalSupply)
        ERC20("WeSendit", "WSI")
        ERC20Capped(TOTAL_SUPPLY)
        BaseWeSenditToken()
    {
        ERC20Capped._mint(addressTotalSupply, TOTAL_SUPPLY);
    }

    /**
     * @inheritdoc ERC20
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        _preValidateTransfer(from, to, amount);
    }

    /**
     * Transfer token with fee reflection
     *
     * @inheritdoc ERC20
     */
    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        address from = _msgSender();

        // Calculate applied fees
        (uint256 tTotal, uint256 tFees) = _calculateFees(from, to, amount);

        // Transfer fees if needed
        if (tFees > 0) {
            require(
                super.transfer(address(dynamicFeeManager()), tFees),
                "WeSendit: Failed to transfer fees"
            );

            // Reflect fees
            _reflectFees(from, to, amount);
        }

        return super.transfer(to, tTotal);
    }

    /**
     * Transfer token with fee reflection
     *
     * @inheritdoc ERC20
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        // Calculate applied fees
        (uint256 tTotal, uint256 tFees) = _calculateFees(from, to, amount);

        // Transfer fees if needed
        if (tFees > 0) {
            require(
                super.transferFrom(from, address(dynamicFeeManager()), tFees),
                "WeSendit: Failed to transfer fees"
            );

            // Reflect fees
            _reflectFees(from, to, amount);
        }

        return super.transferFrom(from, to, tTotal);
    }

    /**
     * Calculates fees using the dynamic fee manager
     *
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uint256 - Transaction amount
     *
     * @return tTotal - Transaction amount without fee
     * @return tFees - Fee amount
     */
    function _calculateFees(
        address from,
        address to,
        uint256 amount
    ) private view returns (uint256 tTotal, uint256 tFees) {
        /**
         * Only apply fees if:
         * - fees are enabled
         * - sender is not owner
         * - sender is not admin
         * - sender is not on whitelist
         * - receiver is not on receiver whitelist
         */
        if (
            feesEnabled() &&
            from != owner() &&
            !hasRole(ADMIN, from) &&
            !hasRole(FEE_WHITELIST, from) &&
            !hasRole(RECEIVER_FEE_WHITELIST, to)
        ) {
            (tTotal, tFees) = dynamicFeeManager().calculateFees(
                from,
                to,
                amount
            );
        } else {
            tTotal = amount;
            tFees = 0;
        }

        return (tTotal, tFees);
    }

    /**
     * Reflects fees using the dynamic fee manager
     *
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uint256 - Transaction amount
     */
    function _reflectFees(
        address from,
        address to,
        uint256 amount
    ) private {
        dynamicFeeManager().reflectFees(
            address(this),
            from,
            to,
            amount,
            hasRole(ADMIN, from) || hasRole(BYPASS_SWAP_AND_LIQUIFY, from)
        );
    }

    /**
     * Checks if the minimum transaction amount is exceeded and if pause is enabled
     *
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uint256 - Transaction amount
     */
    function _preValidateTransfer(
        address from,
        address to,
        uint256 amount
    ) private view {
        // Check for minimum transaction amount
        require(
            amount >= minTxAmount(),
            "WeSendit: amount is less than minTxAmount"
        );

        /**
         * Only allow transfers if:
         * - token is not paused
         * - sender is owner
         * - sender is admin
         * - sender has bypass role
         */
        require(
            !paused() ||
                from == owner() ||
                hasRole(ADMIN, from) ||
                hasRole(BYPASS_PAUSE, from),
            "WeSendit: transactions are paused"
        );
    }

    // Needed since we inherit from ERC20 and ERC20Capped
    function _mint(address account, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Capped)
    {
        super._mint(account, amount);
    }
}
