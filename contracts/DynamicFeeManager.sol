// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./interfaces/IDynamicFeeManager.sol";

/**
 * @title Dynamic Fee Manager for ERC20 token
 *
 * The dynamic fee manager allows to dynamically add fee rules to ERC20 token transactions.
 * Fees will be applied if the given conditions are met.
 */
contract DynamicFeeManager is
    IDynamicFeeManager,
    AccessControlEnumerable,
    Ownable
{
    using SafeMath for uint256;

    // Admin role, allowed to add and remove fees
    bytes32 public constant ADMIN = keccak256("ADMIN");

    // List of all currently added fees
    FeeEntry[] private _fees;

    constructor() {
        _setupRole(ADMIN, _msgSender());
        _setRoleAdmin(ADMIN, ADMIN);
    }

    receive() external payable {}

    /**
     * Return the fee entry at the given index
     *
     * @param index uint256 - Index of the fee entry
     *
     * @return fee FeeEntry - Fee entry
     */
    function getFee(uint256 index)
        public
        view
        override
        returns (FeeEntry memory fee)
    {
        return _fees[index];
    }

    /**
     * Adds a fee entry to the list of fees
     *
     * @param from address - Sender address OR address(0) for wildcard
     * @param to address - Receiver address OR address(0) for wildcard
     * @param percentage uint256 - Fee percentage to take multiplied by 100000
     * @param destination address - Destination address for the fee
     * @param doCallback bool - Indicates, if a callback should be called at the fee destination
     *
     * @return index uint256 - Index of the newly added fee entry
     */
    function addFee(
        address from,
        address to,
        uint256 percentage,
        address destination,
        bool doCallback
    ) public override onlyRole(ADMIN) returns (uint256 index) {
        FeeEntry memory feeEntry = FeeEntry(
            from,
            to,
            percentage,
            destination,
            doCallback
        );

        _fees.push(feeEntry);

        emit FeeAdded(from, to, percentage, destination);
        return _fees.length - 1;
    }

    /**
     * Removes the fee entry at the given index
     *
     * @param index uint256 - Index to remove
     */
    function removeFee(uint256 index) public override onlyRole(ADMIN) {
        require(index < _fees.length, "DynamicFeeManager: array out of bounds");

        _fees[index] = _fees[_fees.length - 1];
        _fees.pop();

        emit FeeRemoved(index);
    }

    /**
     * Reflects the fee for a transaction
     *
     * @param token address - Address of the ERC20 token used
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uint256 - Transaction amount
     * @param dryRun bool - Indicates, if only calculations should be done without transfering the fees
     *
     * @return tTotal uint256 - Total transaction amount after fees
     * @return tFees uint256 - Total fee amount
     */
    function reflectFees(
        address token,
        address from,
        address to,
        uint256 amount,
        bool dryRun
    ) public override returns (uint256 tTotal, uint256 tFees) {
        for (uint256 i = 0; i < _fees.length; i++) {
            FeeEntry memory fee = _fees[i];

            uint256 tFee = _calculateFee(amount, fee);
            if (fee.from == address(0) || fee.from == from) {
                tFees = tFees.add(tFee);

                if (!dryRun) {
                    _reflectFee(token, from, to, tFee, fee);
                }
            } else if (fee.to == address(0) || fee.to == to) {
                tFees = tFees.add(tFee);

                if (!dryRun) {
                    _reflectFee(token, from, to, tFee, fee);
                }
            }
        }

        tTotal = amount.sub(tFees);
        require(tTotal > 0, "DynamicFeeManager: invalid total amount");
        require(
            tTotal.add(tFees) == amount,
            "DynamicFeeManager: invalid transfer amount"
        );

        return (tTotal, tFees);
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
        return amount.mul(fee.percentage).div(100000); // ex. 125/100000 = 0.000125 = 0.0125%
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
        FeeEntry memory fee
    ) private {
        require(IERC20(token).transfer(fee.destination, tFee));

        if (fee.doCallback) {
            IFeeReceiver(fee.destination).onERC20Received(from, to, tFee);
        }

        emit FeeReflected(token, from, to, tFee, fee.destination);
    }

    // TODO: add swap and liquify
}
